/**
 * Ratelog ETL transforms (Phase 5/6 — see docs/22 §8).
 *
 * Pure functions for the historical `pre_forum_ratelog` → `post_ratings`
 * migration. Kept side-effect free so the CLI driver (ratelog-etl.ts) can
 * test the pipeline against tiny in-memory fixtures.
 *
 * Discuz source schema (verified against
 * reference/db/2026-05-14/db_tongji_main_full.sql.gz):
 *
 *   CREATE TABLE `pre_forum_ratelog` (
 *     `pid` int unsigned NOT NULL DEFAULT '0',
 *     `uid` mediumint unsigned NOT NULL DEFAULT '0',
 *     `username` char(15) NOT NULL DEFAULT '',
 *     `extcredits` tinyint unsigned NOT NULL DEFAULT '0',
 *     `dateline` int unsigned NOT NULL DEFAULT '0',
 *     `score` smallint NOT NULL DEFAULT '0',
 *     `reason` char(40) NOT NULL DEFAULT '',
 *     ...
 *   ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3;
 *
 * uid/pid mapping (per IMPORT-PLAN.md): Discuz uid/pid are the D1 primary
 * keys directly — `users.id = uid`, `posts.id = pid`. "Mapping failure"
 * therefore means the uid/pid does not exist in the migrated D1 (deleted
 * or never-migrated rows). Those rows are recorded in dropped CSVs and
 * dropped from the import set per docs/22 decision #5.
 *
 * Dedup policy (docs/22 §8.3 — reviewer-pinned blocker):
 *   key = (post_id, rater_id, dimension)
 *   created_at = MIN(dateline)
 *   score      = SUM(score)
 *   reason     = the reason from the row with MAX(LENGTH(reason)),
 *                ties broken by earlier row order.
 */

import { RatingDimension } from "@ellie/types";

/** Discuz extcredits → D1 dimension. Worker stores the enum INTEGER directly. */
export function extcreditsToDimension(extcredits: number): RatingDimension | null {
	if (extcredits === 1) return RatingDimension.Credits;
	if (extcredits === 2) return RatingDimension.Coins;
	return null;
}

/**
 * Strip BBCode-style tags `[b]...[/b]` and HTML tags so the reason becomes
 * plain text. Mirrors `stripMarkup()` in
 * `apps/worker/src/handlers/post-rating.ts` so the legacy import lands in
 * `post_ratings.reason` with the same shape as new writes — the public
 * hover list cannot expose raw `[quote]…[/quote]` from imported rows.
 */
export function stripMarkup(input: string): string {
	return input
		.replace(/\[\/?[a-zA-Z][a-zA-Z0-9]*(?:=[^\]]*)?\]/g, "") // BBCode-ish tags
		.replace(/<[^>]+>/g, "") // HTML tags
		.replace(/[\r\n\t]+/g, " "); // collapse whitespace to a space
}

/** Raw ratelog row from the dump parser. `score` is signed; `dateline` is epoch seconds. */
export interface RatelogRawRow {
	pid: number;
	uid: number;
	username: string;
	extcredits: number;
	dateline: number;
	score: number;
	reason: string;
}

/** Normalized + extcredits-filtered row prior to mapping/dedupe. */
export interface NormalizedRatelogRow {
	pid: number;
	uid: number;
	username: string;
	dimension: RatingDimension;
	dateline: number;
	score: number;
	reason: string;
}

/**
 * Normalize a single raw row.
 *
 * - Filters out `extcredits` outside {1, 2} (Discuz had 8 slots; only 1
 *   and 2 are populated for the ratelog in our dump).
 * - Strips BBCode/HTML tags and collapses internal whitespace (mirrors
 *   Worker `stripMarkup()` so legacy reasons land as plain text — without
 *   this `[quote]...[/quote]` would leak into the public hover list).
 * - Hard-caps reason length at `reasonMaxLength` to satisfy the D1 column
 *   constraint and `RATING_REASON_MAX_LENGTH` from shared types.
 */
export function normalizeRatelogRow(
	raw: RatelogRawRow,
	reasonMaxLength: number,
): NormalizedRatelogRow | null {
	const dimension = extcreditsToDimension(raw.extcredits);
	if (dimension === null) return null;

	// Drop rows with non-positive ids (Discuz has occasional 0-uid/0-pid
	// rows from imported legacy data). These would never map anyway.
	if (raw.uid <= 0 || raw.pid <= 0) return null;

	// trim → strip markup → trim again → cap, mirroring Worker processReason
	// minus censor (we don't run the prod censor list on legacy bulk import;
	// historical content has been live for years already).
	const cleanedReason = stripMarkup(raw.reason.trim()).trim().slice(0, reasonMaxLength);

	return {
		pid: raw.pid,
		uid: raw.uid,
		username: (raw.username ?? "").trim().slice(0, 32),
		dimension,
		dateline: raw.dateline,
		score: raw.score,
		reason: cleanedReason,
	};
}

/** Dedupe key for the (post, rater, dimension) merge. */
function dedupeKey(row: NormalizedRatelogRow): string {
	return `${row.pid}|${row.uid}|${row.dimension}`;
}

/** Result of one dedupe key's merge. Mirrors NormalizedRatelogRow + bookkeeping. */
export interface MergedRatelogRow {
	pid: number;
	uid: number;
	username: string;
	dimension: RatingDimension;
	createdAt: number; // MIN(dateline)
	score: number; // SUM(score)
	reason: string; // longest reason wins
	sourceRowCount: number; // how many raw rows collapsed into this one
}

export interface DedupeMergeReport {
	merged: MergedRatelogRow[];
	/** Per-key merge audit trail for SUMMARY/CSV output. */
	mergedKeys: Array<{
		pid: number;
		uid: number;
		dimension: RatingDimension;
		sourceCount: number;
		sumScore: number;
		minCreatedAt: number;
		reasonSourceLength: number;
	}>;
}

/**
 * Merge duplicate `(pid, uid, dimension)` rows into a single row per key.
 *
 * Reviewer note: the active uniqueness constraint
 * `uq_post_ratings_active(rater_id, post_id, dimension) WHERE revoked_at=0`
 * forbids inserting more than one active row per key — without this merge
 * the insert phase would silently fail (or worse, partial-import in chunks).
 */
export function mergeDuplicates(rows: NormalizedRatelogRow[]): DedupeMergeReport {
	const buckets = new Map<string, NormalizedRatelogRow[]>();
	for (const row of rows) {
		const key = dedupeKey(row);
		const existing = buckets.get(key);
		if (existing) {
			existing.push(row);
		} else {
			buckets.set(key, [row]);
		}
	}

	const merged: MergedRatelogRow[] = [];
	const mergedKeys: DedupeMergeReport["mergedKeys"] = [];

	for (const [, group] of buckets) {
		// Single-row buckets: pass through with sourceRowCount=1.
		if (group.length === 1) {
			const r = group[0];
			merged.push({
				pid: r.pid,
				uid: r.uid,
				username: r.username,
				dimension: r.dimension,
				createdAt: r.dateline,
				score: r.score,
				reason: r.reason,
				sourceRowCount: 1,
			});
			continue;
		}

		// Multi-row buckets: merge per docs/22 §8.3.
		let minCreatedAt = group[0].dateline;
		let sumScore = 0;
		let bestReason = "";
		let bestReasonLength = -1;
		let username = group[0].username;
		for (const r of group) {
			if (r.dateline < minCreatedAt) minCreatedAt = r.dateline;
			sumScore += r.score;
			if (r.reason.length > bestReasonLength) {
				bestReason = r.reason;
				bestReasonLength = r.reason.length;
			}
			// Prefer non-empty username (Discuz occasionally drops it).
			if (!username && r.username) username = r.username;
		}

		merged.push({
			pid: group[0].pid,
			uid: group[0].uid,
			username,
			dimension: group[0].dimension,
			createdAt: minCreatedAt,
			score: sumScore,
			reason: bestReason,
			sourceRowCount: group.length,
		});
		mergedKeys.push({
			pid: group[0].pid,
			uid: group[0].uid,
			dimension: group[0].dimension,
			sourceCount: group.length,
			sumScore,
			minCreatedAt,
			reasonSourceLength: bestReasonLength,
		});
	}

	return { merged, mergedKeys };
}

// ─── Mapping ────────────────────────────────────────────────

/**
 * Result of applying uid/pid lookups against the migrated D1.
 *
 * `accepted` rows survived both lookups; `droppedUid` / `droppedPid` are
 * recorded so the CSVs can be regenerated deterministically from the
 * merged set. Failure attribution is per-row: if BOTH the uid and pid are
 * missing we report the uid drop (uid is checked first — see applyMapping).
 */
export interface MappingResult {
	accepted: AcceptedRow[];
	droppedUid: MergedRatelogRow[];
	droppedPid: MergedRatelogRow[];
}

/** A merged row enriched with the post's `thread_id` (denormalized into post_ratings). */
export interface AcceptedRow extends MergedRatelogRow {
	threadId: number;
}

/**
 * Apply uid/pid lookups. The lookups are functions so the caller can wire
 * either a bun:sqlite handle or an in-memory test fixture.
 *
 * uid lookup: returns `true` iff the uid exists in D1 `users`.
 * pid lookup: returns the `thread_id` for the post, or `null` if missing.
 */
export function applyMapping(
	rows: MergedRatelogRow[],
	hasUser: (uid: number) => boolean,
	getPostThreadId: (pid: number) => number | null,
): MappingResult {
	const accepted: AcceptedRow[] = [];
	const droppedUid: MergedRatelogRow[] = [];
	const droppedPid: MergedRatelogRow[] = [];

	for (const row of rows) {
		if (!hasUser(row.uid)) {
			droppedUid.push(row);
			continue;
		}
		const threadId = getPostThreadId(row.pid);
		if (threadId === null) {
			droppedPid.push(row);
			continue;
		}
		accepted.push({ ...row, threadId });
	}

	return { accepted, droppedUid, droppedPid };
}

// ─── SQL chunk building ─────────────────────────────────────

/** Escape a string for inline inclusion in a SQL VALUES list. */
export function sqlString(value: string): string {
	// Strip NULL bytes (corrupt legacy data) then escape single quotes.
	const clean = value.replaceAll("\x00", "").replace(/'/g, "''");
	return `'${clean}'`;
}

/** One INSERT statement for a chunk of accepted rows. Does NOT include trailing semicolon comments. */
export function buildInsertChunk(rows: AcceptedRow[]): string {
	if (rows.length === 0) return "";
	const header =
		"INSERT INTO post_ratings (post_id, thread_id, rater_id, rater_name, dimension, score, reason, created_at, revoked_at, revoked_by) VALUES";
	const values = rows
		.map(
			(r) =>
				`  (${r.pid}, ${r.threadId}, ${r.uid}, ${sqlString(r.username)}, ${r.dimension}, ${r.score}, ${sqlString(r.reason)}, ${r.createdAt}, 0, 0)`,
		)
		.join(",\n");
	return `${header}\n${values};\n`;
}

/** Split accepted rows into 5000-row chunks (or whatever the caller passes). */
export function chunkRows<T>(rows: T[], chunkSize: number): T[][] {
	if (chunkSize <= 0) throw new Error(`chunkSize must be positive, got ${chunkSize}`);
	const out: T[][] = [];
	for (let i = 0; i < rows.length; i += chunkSize) {
		out.push(rows.slice(i, i + chunkSize));
	}
	return out;
}

// ─── Summary ────────────────────────────────────────────────

export interface EtlSummary {
	dumpPath: string;
	mappingDbPath: string;
	mappingDbMtime: string;
	mappingUserCount: number;
	mappingPostCount: number;
	totalRawRows: number;
	normalizedRows: number;
	droppedExtcredits: number;
	droppedZeroIds: number;
	mergedKeyCount: number; // distinct keys that had >1 source row
	mergedSourceRowsCollapsed: number; // sum(sourceRowCount-1) across multi-row keys
	acceptedRows: number;
	droppedUidRows: number;
	droppedPidRows: number;
	sumScoreCredits: number;
	sumScoreCoins: number;
	chunkFileCount: number;
	chunkSize: number;
	rebuildSql: "skipped" | "generated";
	rebuildReason: string;
}

/** Render the SUMMARY.md body. Kept as a pure function so the test can snapshot it. */
export function renderSummaryMarkdown(s: EtlSummary): string {
	const lines: string[] = [
		"# Post-rating ETL Dry-run Summary",
		"",
		`- Dump source: \`${s.dumpPath}\``,
		`- Mapping DB: \`${s.mappingDbPath}\` (mtime ${s.mappingDbMtime})`,
		`  - users rows: ${s.mappingUserCount}`,
		`  - posts rows: ${s.mappingPostCount}`,
		"",
		"## Row accounting",
		"",
		"| Stage | Count |",
		"| ----- | ----- |",
		`| Raw \`pre_forum_ratelog\` rows | ${s.totalRawRows} |`,
		`| Dropped: extcredits ∉ {1,2} | ${s.droppedExtcredits} |`,
		`| Dropped: uid=0 or pid=0 | ${s.droppedZeroIds} |`,
		`| Normalized rows | ${s.normalizedRows} |`,
		`| Merged keys (>1 source row) | ${s.mergedKeyCount} |`,
		`| Extra rows collapsed by merge | ${s.mergedSourceRowsCollapsed} |`,
		`| Dropped: uid not in users | ${s.droppedUidRows} |`,
		`| Dropped: pid not in posts | ${s.droppedPidRows} |`,
		`| **Accepted (inserted)** | **${s.acceptedRows}** |`,
		"",
		"## Score sums",
		"",
		`- credits (dimension=1): ${s.sumScoreCredits}`,
		`- coins   (dimension=2): ${s.sumScoreCoins}`,
		"",
		"## SQL output",
		"",
		`- INSERT chunks: ${s.chunkFileCount} file(s), chunkSize=${s.chunkSize}`,
		`- Rebuild SQL: ${s.rebuildSql} — ${s.rebuildReason}`,
		"",
		"## Canonical path",
		"",
		"Script lives at `packages/migrate/src/transform/ratelog.ts` and",
		"`packages/migrate/src/ratelog-etl.ts`. docs/22 §8 will be amended in",
		"Phase 6 to point here; `scripts/migrate/` is frozen legacy per",
		"`scripts/migrate/IMPORT-PLAN.md` and must not be modified.",
		"",
	];
	return lines.join("\n");
}

/** Render `dropped-uid.csv` / `dropped-pid.csv` / `merged.csv` (header + rows). */
export function renderDroppedCsv(label: "uid" | "pid", rows: MergedRatelogRow[]): string {
	const lines = [
		"pid,uid,dimension,score,created_at,reason",
		...rows.map(
			(r) => `${r.pid},${r.uid},${r.dimension},${r.score},${r.createdAt},${csvEscape(r.reason)}`,
		),
	];
	// label is informational — kept in signature so callers don't typo file names.
	void label;
	return `${lines.join("\n")}\n`;
}

export function renderMergedCsv(report: DedupeMergeReport): string {
	const lines = [
		"pid,uid,dimension,source_rows,sum_score,min_created_at,reason_source_length",
		...report.mergedKeys.map(
			(m) =>
				`${m.pid},${m.uid},${m.dimension},${m.sourceCount},${m.sumScore},${m.minCreatedAt},${m.reasonSourceLength}`,
		),
	];
	return `${lines.join("\n")}\n`;
}

function csvEscape(value: string): string {
	if (value.includes(",") || value.includes('"') || value.includes("\n")) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}
