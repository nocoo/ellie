/**
 * Build `forum_thread_types` rows + translation maps for the migration.
 *
 * Combines two Discuz sources that together define 主题分类:
 *
 *   1. `pre_forum_forumfield.threadtypes` (parsed into ThreadTypesConfig)
 *      — admin's CURRENT enabled-set: which types the picker shows now,
 *      their names, icons (in icons map), and moderator-only flag.
 *
 *   2. `pre_forum_threadclass` (parsed into ThreadClassRow)
 *      — per-forum row table that ALSO holds typeid/name/displayorder/
 *      icon/moderators, populated by the same admin paths. Includes
 *      legacy/disabled rows (tombstones) that forumfield.types has since
 *      dropped from the enabled set but old threads still reference via
 *      `thread.typeid`.
 *
 * Reviewer merge policy (msg 73d85116):
 *   • Enabled set = `forumfield.types` (admin's current view).
 *   • For typeids ∈ enabled-set: name + display_order from forumfield.
 *     icon/moderator fall back to threadclass when forumfield empty.
 *   • For typeids ∈ threadclass but ∉ forumfield.types: tombstone row
 *     (enabled=0) using threadclass.name etc.
 *
 * ──────────────────────── Synthetic ID layer (0039) ──────────────────────
 *
 * A 2026-05-14 dry-run on `db_tongji_main_full.sql.gz` proved Discuz
 * `typeid` is forum-LOCAL (typeid=1 in fid=111+113, typeid=2 in
 * fid=113+134, typeid=0 in fid=113). Migration 0039 splits the
 * identity:
 *
 *   • `id`             — D1 SYNTHETIC global id minted here.
 *   • `source_typeid`  — Discuz local typeid preserved for admin/debug.
 *
 * Mint algorithm: sort the union of forum-side typeid sources by
 * `(forum_id ASC, source_typeid ASC)` and increment a counter starting
 * at 1. Deterministic across runs given the same parsed inputs, which
 * matters for dry-run diffability and for test fixtures.
 *
 * source_typeid=0 exception (reviewer pin c5d10236): Discuz allows a
 * type with typeid=0 (we observed it in fid=113 PUB), but we do NOT
 * insert an enabled row for source_typeid=0. The thread-side semantics
 * are "no category"; promoting it to a synthetic id would silently
 * label every uncategorized thread under PUB. Definitions are still
 * recorded in `zeroTypeidDefinitions` so admin/debug can recover them.
 *
 * Outputs consumed by callers:
 *   • `rows` — INSERT into `forum_thread_types` (now includes
 *     `source_typeid`).
 *   • `nameMap` — (fid → source_typeid → name) for `extractThread` to
 *     fill `threads.type_name`.
 *   • `syntheticIdMap` — (fid → source_typeid → synthetic id) for
 *     `extractThread` to translate `thread.typeid` → `threads.type_id`.
 *   • diagnostics for the dry-run mapping artifact.
 */

import type { ThreadClassRow } from "../extract/extractors";
import type { RowRecord } from "../load/batch-insert";
import type { ThreadTypesConfig } from "./threadtypes";

/**
 * Build one forum's resolved (typeid → name) map per the merge policy.
 *
 * Split out for unit testability and so the same precedence runs for
 * both the rows-builder and the thread-name resolver. typeid=0 is
 * KEPT in the name map so historical threads with typeid=0 (rare —
 * only forums that explicitly defined it in admin) can still resolve
 * a label for the legacy badge; the rows builder is what skips
 * source_typeid=0 from enabled rows.
 */
function resolveTypeNamesForForum(
	config: ThreadTypesConfig | undefined,
	classRows: ThreadClassRow[],
): Map<number, string> {
	const out = new Map<number, string>();
	// Enabled-set names first (admin's current source-of-truth).
	if (config) {
		for (const [typeid, name] of config.types) {
			if (name) out.set(typeid, name);
		}
	}
	// Tombstone names fill in the gaps (typeids in threadclass but not
	// in forumfield.types). We do NOT overwrite an existing entry — the
	// enabled-set's name is canonical.
	for (const row of classRows) {
		if (out.has(row.typeid)) continue;
		if (row.name) out.set(row.typeid, row.name);
	}
	return out;
}

/**
 * Build the global `(fid → typeid → name)` resolution map used by
 * `extractThread` to fill `threads.type_name`. Built once at startup so
 * thread extraction stays O(1) per row.
 *
 * `forumTypeConfigs` keyed by fid; `threadClassByForum` keyed by fid.
 * Forums missing from both inputs simply absent from the result —
 * extractThread falls back to the legacy global threadtype map.
 */
export function buildForumThreadTypeNameMap(
	forumTypeConfigs: Map<number, ThreadTypesConfig>,
	threadClassByForum: Map<number, ThreadClassRow[]>,
): Map<number, Map<number, string>> {
	const out = new Map<number, Map<number, string>>();
	// Union of fids that have either source.
	const fids = new Set<number>();
	for (const fid of forumTypeConfigs.keys()) fids.add(fid);
	for (const fid of threadClassByForum.keys()) fids.add(fid);

	for (const fid of fids) {
		const resolved = resolveTypeNamesForForum(
			forumTypeConfigs.get(fid),
			threadClassByForum.get(fid) ?? [],
		);
		if (resolved.size > 0) out.set(fid, resolved);
	}
	return out;
}

/** Source side that defined a (fid, typeid=0) row, kept for diagnostics only. */
export interface ZeroTypeidDefinition {
	fid: number;
	name: string;
	source: "forumfield" | "threadclass";
}

/** Per-forum reconciliation breakdown — diagnostic, not feeding the row builder. */
export interface ForumReconciliation {
	fid: number;
	forumfieldOnly: number[]; // typeids only in forumfield.types
	threadclassOnly: number[]; // typeids only in threadclass
	both: number[]; // typeids in both
	zeroIncluded: boolean; // true if either side defined typeid=0
	enabledRows: number; // emitted enabled rows for this fid
	tombstoneRows: number; // emitted tombstone rows for this fid
}

/** Source typeids that appear in multiple forums (the reason 0039 exists). */
export interface SourceTypeidGlobalDuplicate {
	source_typeid: number;
	forums: number[]; // sorted ascending
}

export interface ForumThreadTypesResult {
	rows: RowRecord[];
	nameMap: Map<number, Map<number, string>>;
	/** (fid → source_typeid → synthetic id) — extractThread translates thread.typeid through this. */
	syntheticIdMap: Map<number, Map<number, number>>;
	zeroTypeidDefinitions: ZeroTypeidDefinition[];
	perForumReconciliation: ForumReconciliation[];
	sourceTypeidGlobalDuplicates: SourceTypeidGlobalDuplicate[];
}

/**
 * Pre-pass: collect (source_typeid → set of fids) across both inputs.
 * Powers the `sourceTypeidGlobalDuplicates` diagnostic — exactly the
 * collisions that 0038's single-PK design used to swallow.
 */
function buildSourceTypeidTracker(
	forumTypeConfigs: Map<number, ThreadTypesConfig>,
	threadClassByForum: Map<number, ThreadClassRow[]>,
): Map<number, Set<number>> {
	const sourceTypeidToForums = new Map<number, Set<number>>();
	const track = (fid: number, typeid: number) => {
		const set = sourceTypeidToForums.get(typeid);
		if (set) set.add(fid);
		else sourceTypeidToForums.set(typeid, new Set([fid]));
	};
	for (const [fid, cfg] of forumTypeConfigs) {
		for (const typeid of cfg.types.keys()) track(fid, typeid);
	}
	for (const [fid, rows] of threadClassByForum) {
		for (const row of rows) track(fid, row.typeid);
	}
	return sourceTypeidToForums;
}

/** Sorted union of fids from both inputs. */
function unionForumIds(
	forumTypeConfigs: Map<number, ThreadTypesConfig>,
	threadClassByForum: Map<number, ThreadClassRow[]>,
): number[] {
	const fids = new Set<number>();
	for (const fid of forumTypeConfigs.keys()) fids.add(fid);
	for (const fid of threadClassByForum.keys()) fids.add(fid);
	return [...fids].sort((a, b) => a - b);
}

interface ForumPartition {
	both: number[];
	forumfieldOnly: number[];
	threadclassOnly: number[];
	zeroIncluded: boolean;
}

/** Split forumfield/threadclass typeids into intersection and per-side leftovers. */
function partitionTypeids(ffTypeids: Set<number>, classTypeids: Set<number>): ForumPartition {
	const both: number[] = [];
	const forumfieldOnly: number[] = [];
	const threadclassOnly: number[] = [];
	for (const t of ffTypeids) {
		if (classTypeids.has(t)) both.push(t);
		else forumfieldOnly.push(t);
	}
	for (const t of classTypeids) {
		if (!ffTypeids.has(t)) threadclassOnly.push(t);
	}
	const cmp = (a: number, b: number) => a - b;
	both.sort(cmp);
	forumfieldOnly.sort(cmp);
	threadclassOnly.sort(cmp);
	return {
		both,
		forumfieldOnly,
		threadclassOnly,
		zeroIncluded: ffTypeids.has(0) || classTypeids.has(0),
	};
}

/** Capture (fid, typeid=0) definitions from either side for diagnostics. */
function captureZeroTypeidDefinitions(
	fid: number,
	cfg: ThreadTypesConfig | undefined,
	classByTypeid: Map<number, ThreadClassRow>,
	sink: ZeroTypeidDefinition[],
): void {
	if (cfg?.types.has(0)) {
		sink.push({ fid, name: cfg.types.get(0) ?? "", source: "forumfield" });
	}
	const zeroClassRow = classByTypeid.get(0);
	if (zeroClassRow && !cfg?.types.has(0)) {
		sink.push({ fid, name: zeroClassRow.name, source: "threadclass" });
	}
}

/** Mutable counter for `nextSyntheticId++` shared across helpers. */
interface MintCounter {
	next: number;
}

/**
 * Mint enabled rows in forumfield.types iteration order. Skips typeid=0
 * (reviewer pin c5d10236). Returns count of rows added.
 */
function mintEnabledRows(
	fid: number,
	cfg: ThreadTypesConfig | undefined,
	resolved: Map<number, string>,
	classByTypeid: Map<number, ThreadClassRow>,
	rows: RowRecord[],
	fidSyntheticIds: Map<number, number>,
	seen: Set<number>,
	counter: MintCounter,
): number {
	if (!cfg) return 0;
	let displayOrder = 0;
	let enabledRows = 0;
	for (const typeid of cfg.types.keys()) {
		seen.add(typeid);
		if (typeid === 0) continue;
		const cls = classByTypeid.get(typeid);
		const ffIcon = cfg.icons.get(typeid) ?? "";
		const icon = ffIcon || cls?.icon || "";
		const moderatorOnly = cfg.moderatorOnly.has(typeid) || (cls?.moderators ?? 0) > 0 ? 1 : 0;
		const syntheticId = counter.next++;
		fidSyntheticIds.set(typeid, syntheticId);
		rows.push({
			id: syntheticId,
			forum_id: fid,
			source_typeid: typeid,
			name: resolved.get(typeid) ?? "",
			display_order: displayOrder++,
			icon,
			enabled: 1,
			moderator_only: moderatorOnly,
		});
		enabledRows++;
	}
	return enabledRows;
}

/**
 * Mint tombstone rows for typeids that exist only in threadclass. Sorted
 * ascending so synthetic-id allocation is deterministic. Skips typeid=0.
 */
function mintTombstoneRows(
	fid: number,
	classRows: ThreadClassRow[],
	rows: RowRecord[],
	fidSyntheticIds: Map<number, number>,
	seen: Set<number>,
	counter: MintCounter,
): number {
	const tombstoneCandidates = classRows
		.filter((c) => !seen.has(c.typeid))
		.sort((a, b) => a.typeid - b.typeid);
	let tombstoneRows = 0;
	for (const cls of tombstoneCandidates) {
		seen.add(cls.typeid);
		if (cls.typeid === 0) continue;
		const syntheticId = counter.next++;
		fidSyntheticIds.set(cls.typeid, syntheticId);
		rows.push({
			id: syntheticId,
			forum_id: fid,
			source_typeid: cls.typeid,
			name: cls.name,
			display_order: cls.displayorder,
			icon: cls.icon,
			enabled: 0,
			moderator_only: cls.moderators > 0 ? 1 : 0,
		});
		tombstoneRows++;
	}
	return tombstoneRows;
}

/** Project (typeid → fids) tracker into the public duplicates diagnostic. */
function aggregateGlobalDuplicates(
	sourceTypeidToForums: Map<number, Set<number>>,
): SourceTypeidGlobalDuplicate[] {
	const out: SourceTypeidGlobalDuplicate[] = [];
	const sortedTypeids = [...sourceTypeidToForums.keys()].sort((a, b) => a - b);
	for (const typeid of sortedTypeids) {
		const forums = sourceTypeidToForums.get(typeid);
		if (!forums || forums.size < 2) continue;
		out.push({ source_typeid: typeid, forums: [...forums].sort((a, b) => a - b) });
	}
	return out;
}

/**
 * Build `forum_thread_types` rows for the entire migration with synthetic
 * global IDs and full diagnostics.
 *
 * Mint order: forums sorted ascending by fid; within each forum,
 * forumfield.types iteration order first (enabled rows), then remaining
 * threadclass typeids in ascending order (tombstones).
 * source_typeid=0 is excluded from emitted rows entirely, but kept as a
 * zeroTypeidDefinition diagnostic.
 */
export function buildForumThreadTypeRows(
	forumTypeConfigs: Map<number, ThreadTypesConfig>,
	threadClassByForum: Map<number, ThreadClassRow[]>,
): ForumThreadTypesResult {
	const sourceTypeidToForums = buildSourceTypeidTracker(forumTypeConfigs, threadClassByForum);
	const sortedFids = unionForumIds(forumTypeConfigs, threadClassByForum);

	const rows: RowRecord[] = [];
	const nameMap = new Map<number, Map<number, string>>();
	const syntheticIdMap = new Map<number, Map<number, number>>();
	const zeroTypeidDefinitions: ZeroTypeidDefinition[] = [];
	const perForumReconciliation: ForumReconciliation[] = [];
	const counter: MintCounter = { next: 1 };

	for (const fid of sortedFids) {
		const cfg = forumTypeConfigs.get(fid);
		const classRows = threadClassByForum.get(fid) ?? [];

		const resolved = resolveTypeNamesForForum(cfg, classRows);
		if (resolved.size > 0) nameMap.set(fid, resolved);

		const classByTypeid = new Map<number, ThreadClassRow>();
		for (const row of classRows) classByTypeid.set(row.typeid, row);

		const ffTypeids = cfg ? new Set(cfg.types.keys()) : new Set<number>();
		const classTypeids = new Set(classRows.map((r) => r.typeid));
		const partition = partitionTypeids(ffTypeids, classTypeids);

		captureZeroTypeidDefinitions(fid, cfg, classByTypeid, zeroTypeidDefinitions);

		const fidSyntheticIds = new Map<number, number>();
		const seen = new Set<number>();
		const enabledRows = mintEnabledRows(
			fid,
			cfg,
			resolved,
			classByTypeid,
			rows,
			fidSyntheticIds,
			seen,
			counter,
		);
		const tombstoneRows = mintTombstoneRows(fid, classRows, rows, fidSyntheticIds, seen, counter);

		if (fidSyntheticIds.size > 0) syntheticIdMap.set(fid, fidSyntheticIds);

		perForumReconciliation.push({
			fid,
			forumfieldOnly: partition.forumfieldOnly,
			threadclassOnly: partition.threadclassOnly,
			both: partition.both,
			zeroIncluded: partition.zeroIncluded,
			enabledRows,
			tombstoneRows,
		});
	}

	return {
		rows,
		nameMap,
		syntheticIdMap,
		zeroTypeidDefinitions,
		perForumReconciliation,
		sourceTypeidGlobalDuplicates: aggregateGlobalDuplicates(sourceTypeidToForums),
	};
}
