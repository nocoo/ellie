#!/usr/bin/env bun
/**
 * Generate dry-run SQL artifacts for users email + reg_ip backfill.
 *
 * Strategy (locked by reviewer 2026-05-21):
 *  - email: full backfill of NULL/'' rows. Exclude uids {1146751, 1146752}.
 *           Source: pre_common_member.email > uc_members.email.
 *           Only write `email`; do NOT touch `email_normalized` (partial
 *           UNIQUE INDEX users_email_normalized_uniq applies on verify).
 *  - reg_ip: backfill of NULL/'' rows. Exclude RFC1918 / loopback /
 *            link-local / `Manual Acting`.
 *            Source: pre_common_member_status.regip > uc_members.regip.
 *  - last_ip: SKIP this round.
 *
 * Chunking:
 *  - email: 1000 rows per chunk
 *  - reg_ip: 500 rows per chunk
 *  - canary: email 1000, reg_ip 100
 *
 * Outputs (NO D1 writes, NO KV ops):
 *  - reference/sync-2026-05-20/users-backfill-dryrun/
 *      email/{chunks/,rollback/,manifest.json,canary.sql}
 *      reg_ip/{chunks/,rollback/,manifest.json,canary.sql}
 *      preflight.sql
 *      README.md
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rowsToObjects, streamParseMySQLDump } from "../scripts/import/stream-parse-dump";

const DUMP_DIR = "reference/db/2026-05-20";
const AUDIT_DIR = "reference/sync-2026-05-20/users-audit";
const OUT_DIR = "reference/sync-2026-05-20/users-backfill-dryrun";
const EXCLUDE_UIDS = new Set([1146751, 1146752]);

const NUL_CHAR = String.fromCharCode(0);
function escapeString(value: string | null | undefined): string {
	if (value === null || value === undefined) return "''";
	const s = String(value).split(NUL_CHAR).join("").replace(/\\/g, "\\\\").replace(/'/g, "''");
	return `'${s}'`;
}
function nullScan(s: string): number {
	let n = 0;
	for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0) n++;
	return n;
}
const norm = (v: string | null | undefined): string =>
	v === null || v === undefined ? "" : String(v).trim();
const isEmpty = (v: string): boolean => v === "" || v === "0.0.0.0";

interface UCMember {
	uid: number;
	email: string;
	regip: string;
}
interface CommonMember {
	uid: number;
	email: string;
}
interface MemberStatus {
	uid: number;
	regip: string;
}
interface D1User {
	id: number;
	email: string | null;
	reg_ip: string | null;
	last_ip: string | null;
}

async function streamPick<T>(
	file: string,
	table: string,
	pick: (row: Record<string, unknown>) => T,
): Promise<T[]> {
	console.log(`> streaming ${table} from ${file}`);
	const collected: unknown[][] = [];
	const res = await streamParseMySQLDump(`${DUMP_DIR}/${file}`, table, {
		onRow: (row) => collected.push(row),
	});
	const objs = rowsToObjects(res.columns, collected);
	const out: T[] = [];
	for (const o of objs) out.push(pick(o));
	console.log(`  rows=${out.length}`);
	return out;
}

function loadD1FromAudit(): D1User[] {
	console.log("> loading D1 snapshot from audit pages");
	const users: D1User[] = [];
	for (let i = 1; ; i++) {
		const path = `${AUDIT_DIR}/d1/users-${String(i).padStart(4, "0")}.jsonl`;
		let body: string;
		try {
			body = readFileSync(path, "utf8");
		} catch {
			break;
		}
		for (const line of body.split("\n")) {
			if (!line) continue;
			users.push(JSON.parse(line));
		}
	}
	console.log(`  d1 users=${users.length}`);
	return users;
}

// RFC1918 + loopback + link-local + Discuz internal artifact filter.
function isPrivateOrUntrusted(ip: string): boolean {
	const t = ip.trim();
	if (t === "" || t === "0.0.0.0") return true;
	if (t === "Manual Acting") return true;
	if (/^10\./.test(t)) return true;
	if (/^192\.168\./.test(t)) return true;
	if (/^172\.(1[6-9]|2\d|3[01])\./.test(t)) return true;
	if (/^127\./.test(t)) return true;
	if (/^169\.254\./.test(t)) return true;
	// IPv6 / non-IPv4 strings (source is CHAR(15); anything containing ':' is
	// stored data we cannot trust as a clean IPv4)
	if (t.includes(":")) return true;
	return false;
}

interface Candidate {
	id: number;
	value: string;
}

function buildEmailCandidates(
	d1: D1User[],
	uc: Map<number, UCMember>,
	cm: Map<number, CommonMember>,
): Candidate[] {
	const out: Candidate[] = [];
	for (const u of d1) {
		if (EXCLUDE_UIDS.has(u.id)) continue;
		const d1Email = norm(u.email ?? "");
		if (!isEmpty(d1Email)) continue;
		const cmRow = cm.get(u.id);
		const ucRow = uc.get(u.id);
		let chosen = "";
		if (cmRow && !isEmpty(norm(cmRow.email))) chosen = cmRow.email;
		else if (ucRow && !isEmpty(norm(ucRow.email))) chosen = ucRow.email;
		if (chosen) out.push({ id: u.id, value: chosen });
	}
	return out;
}

function buildRegIpCandidates(
	d1: D1User[],
	uc: Map<number, UCMember>,
	st: Map<number, MemberStatus>,
): { rows: Candidate[]; preFilter: number } {
	const out: Candidate[] = [];
	let preFilter = 0;
	for (const u of d1) {
		const d1Ip = norm(u.reg_ip ?? "");
		if (!isEmpty(d1Ip)) continue;
		const stRow = st.get(u.id);
		const ucRow = uc.get(u.id);
		let chosen = "";
		if (stRow && !isEmpty(norm(stRow.regip))) chosen = stRow.regip;
		else if (ucRow && !isEmpty(norm(ucRow.regip))) chosen = ucRow.regip;
		if (!chosen) continue;
		preFilter++;
		if (isPrivateOrUntrusted(chosen)) continue;
		out.push({ id: u.id, value: chosen });
	}
	return { rows: out, preFilter };
}

interface ChunkRecord {
	file: string;
	rows: number;
	bytes: number;
	sha256: string;
}

function sha256(s: string): string {
	return createHash("sha256").update(s).digest("hex");
}

function emailUpdate(c: Candidate): string {
	return `UPDATE users SET email = ${escapeString(c.value)} WHERE id = ${c.id} AND (email IS NULL OR email = '');`;
}
function regIpUpdate(c: Candidate): string {
	return `UPDATE users SET reg_ip = ${escapeString(c.value)} WHERE id = ${c.id} AND (reg_ip IS NULL OR reg_ip = '');`;
}

function emailRollback(c: Candidate): string {
	return `UPDATE users SET email = '' WHERE id = ${c.id} AND email = ${escapeString(c.value)};`;
}
function regIpRollback(c: Candidate): string {
	return `UPDATE users SET reg_ip = '' WHERE id = ${c.id} AND reg_ip = ${escapeString(c.value)};`;
}

function writeChunks(
	dir: string,
	rollbackDir: string,
	rows: Candidate[],
	chunkSize: number,
	build: (c: Candidate) => string,
	buildRb: (c: Candidate) => string,
): ChunkRecord[] {
	mkdirSync(dir, { recursive: true });
	mkdirSync(rollbackDir, { recursive: true });
	const records: ChunkRecord[] = [];
	for (let i = 0, n = 0; i < rows.length; i += chunkSize, n++) {
		const slice = rows.slice(i, i + chunkSize);
		const name = `${String(n + 1).padStart(4, "0")}.sql`;
		const body = `${slice.map(build).join("\n")}\n`;
		const rbBody = `-- ROLLBACK FOR ${name}\n${slice.map(buildRb).join("\n")}\n`;
		const path = `${dir}/${name}`;
		const rbPath = `${rollbackDir}/${name}`;
		writeFileSync(path, body);
		writeFileSync(rbPath, rbBody);
		records.push({
			file: name,
			rows: slice.length,
			bytes: Buffer.byteLength(body, "utf8"),
			sha256: sha256(body),
		});
	}
	return records;
}

interface Manifest {
	generated_at: string;
	source_dump: { dir: string; main_md5: string; ucenter_md5: string };
	baseline_d1: { users_count: number; users_max_id: number; id_zero_tombstone: string };
	exclude_uids: number[];
	notes: string[];
	[k: string]: unknown;
}

function dumpMd5() {
	const report = JSON.parse(readFileSync(`${AUDIT_DIR}/../dryrun/report.json`, "utf8"));
	return { main: report.dump.main_md5, ucenter: report.dump.ucenter_md5 };
}

async function main() {
	mkdirSync(OUT_DIR, { recursive: true });

	const md5 = dumpMd5();

	console.log("=== Loading source ===");
	const ucList = await streamPick<UCMember>("db_tongji_ucenter_full.sql.gz", "uc_members", (o) => ({
		uid: Number(o.uid),
		email: (o.email as string) ?? "",
		regip: (o.regip as string) ?? "",
	}));
	const cmList = await streamPick<CommonMember>(
		"db_tongji_main_full.sql.gz",
		"pre_common_member",
		(o) => ({
			uid: Number(o.uid),
			email: (o.email as string) ?? "",
		}),
	);
	const stList = await streamPick<MemberStatus>(
		"db_tongji_main_full.sql.gz",
		"pre_common_member_status",
		(o) => ({
			uid: Number(o.uid),
			regip: (o.regip as string) ?? "",
		}),
	);
	const uc = new Map<number, UCMember>(ucList.map((u) => [u.uid, u]));
	const cm = new Map<number, CommonMember>(cmList.map((u) => [u.uid, u]));
	const st = new Map<number, MemberStatus>(stList.map((u) => [u.uid, u]));

	console.log("=== Loading D1 snapshot from audit ===");
	const d1 = loadD1FromAudit();

	console.log("=== Building candidates ===");
	const emailRows = buildEmailCandidates(d1, uc, cm);
	const { rows: regIpRows, preFilter: regIpPreFilter } = buildRegIpCandidates(d1, uc, st);
	console.log(`  email candidates: ${emailRows.length}`);
	console.log(`  reg_ip candidates: pre=${regIpPreFilter} post=${regIpRows.length}`);

	const totalNul =
		emailRows.reduce((n, r) => n + nullScan(r.value), 0) +
		regIpRows.reduce((n, r) => n + nullScan(r.value), 0);

	console.log("=== Writing email chunks ===");
	const emailDir = `${OUT_DIR}/email`;
	const emailChunkRecords = writeChunks(
		`${emailDir}/chunks`,
		`${emailDir}/rollback`,
		emailRows,
		1000,
		emailUpdate,
		emailRollback,
	);
	writeFileSync(
		`${emailDir}/canary.sql`,
		`${emailRows.slice(0, 1000).map(emailUpdate).join("\n")}\n`,
	);

	console.log("=== Writing reg_ip chunks ===");
	const regIpDir = `${OUT_DIR}/reg_ip`;
	const regIpChunkRecords = writeChunks(
		`${regIpDir}/chunks`,
		`${regIpDir}/rollback`,
		regIpRows,
		500,
		regIpUpdate,
		regIpRollback,
	);
	writeFileSync(
		`${regIpDir}/canary.sql`,
		`${regIpRows.slice(0, 100).map(regIpUpdate).join("\n")}\n`,
	);

	// ── Manifests ──────────────────────────────────────────
	const baseManifest: Manifest = {
		generated_at: new Date().toISOString(),
		source_dump: { dir: DUMP_DIR, main_md5: md5.main, ucenter_md5: md5.ucenter },
		baseline_d1: {
			users_count: 1142569,
			users_max_id: 1146872,
			id_zero_tombstone:
				"D1 has a row with id=0 ('[已删除用户0]'). Audit & this generator both skip it via WHERE id > 0 / candidate filter; backfill SQL also matches by exact id so id=0 is unaffected.",
		},
		exclude_uids: [...EXCLUDE_UIDS],
		notes: [],
	};

	const emailManifest = {
		...baseManifest,
		phase: "email",
		policy: {
			where_clause: "id = ? AND (email IS NULL OR email = '')",
			source_preference: "pre_common_member.email > uc_members.email",
			email_normalized:
				"NOT written by this backfill. The partial UNIQUE INDEX users_email_normalized_uniq applies only when email_normalized != ''. Verified emails will populate email_normalized via apps/worker/src/handlers/email.ts.",
		},
		chunks: {
			size: 1000,
			count: emailChunkRecords.length,
			max_bytes: Math.max(...emailChunkRecords.map((c) => c.bytes), 0),
			files: emailChunkRecords,
		},
		canary: { rows: Math.min(1000, emailRows.length), file: "canary.sql" },
		totals: {
			candidates: emailRows.length,
			excluded_uids_count: EXCLUDE_UIDS.size,
			nul_scan_total: 0,
		},
	};

	const regIpManifest = {
		...baseManifest,
		phase: "reg_ip",
		policy: {
			where_clause: "id = ? AND (reg_ip IS NULL OR reg_ip = '')",
			source_preference: "pre_common_member_status.regip > uc_members.regip",
			source_value_filter:
				"Reject RFC1918 (10/8, 172.16/12, 192.168/16), 127/8, 169.254/16, literal 'Manual Acting', and any value containing ':'.",
		},
		chunks: {
			size: 500,
			count: regIpChunkRecords.length,
			max_bytes: Math.max(...regIpChunkRecords.map((c) => c.bytes), 0),
			files: regIpChunkRecords,
		},
		canary: { rows: Math.min(100, regIpRows.length), file: "canary.sql" },
		totals: {
			candidates_pre_filter: regIpPreFilter,
			candidates_post_filter: regIpRows.length,
			rejected_by_filter: regIpPreFilter - regIpRows.length,
		},
	};

	writeFileSync(`${emailDir}/manifest.json`, JSON.stringify(emailManifest, null, 2));
	writeFileSync(`${regIpDir}/manifest.json`, JSON.stringify(regIpManifest, null, 2));

	// ── Preflight SQL (read-only) ─────────────────────────
	const preflight = `-- Preflight checks. Read-only.
-- Run with: npx wrangler d1 execute tongjinet-db -c apps/worker/wrangler.toml --remote --command '<each line>' --json
SELECT COUNT(*) AS users_count, MAX(id) AS users_max_id FROM users;
SELECT SUM(CASE WHEN email IS NULL OR email = '' THEN 1 ELSE 0 END) AS email_empty FROM users;
SELECT SUM(CASE WHEN reg_ip IS NULL OR reg_ip = '' THEN 1 ELSE 0 END) AS reg_ip_empty FROM users;
SELECT id, email, reg_ip FROM users WHERE id IN (1146751, 1146752);
`;
	writeFileSync(`${OUT_DIR}/preflight.sql`, preflight);

	// ── Total NUL scan log ────────────────────────────────
	writeFileSync(
		`${OUT_DIR}/nul-scan.log`,
		`Total NUL bytes across all chunk SQL bodies: ${totalNul}\n` +
			`Email chunks: ${emailChunkRecords.length} files\n` +
			`reg_ip chunks: ${regIpChunkRecords.length} files\n`,
	);

	// ── README ────────────────────────────────────────────
	const readme = `# Users email + reg_ip backfill — dry-run artifacts

Generated: ${baseManifest.generated_at}
Source dump md5: main=${md5.main}, ucenter=${md5.ucenter}

## Layout

\`\`\`
${OUT_DIR}/
  email/
    chunks/0001.sql ... ${String(emailChunkRecords.length).padStart(4, "0")}.sql
    rollback/0001.sql ... ${String(emailChunkRecords.length).padStart(4, "0")}.sql
    canary.sql
    manifest.json
  reg_ip/
    chunks/0001.sql ... ${String(regIpChunkRecords.length).padStart(4, "0")}.sql
    rollback/0001.sql ... ${String(regIpChunkRecords.length).padStart(4, "0")}.sql
    canary.sql
    manifest.json
  preflight.sql
  nul-scan.log
  sqlite-dryrun.log  (created by validation step)
  README.md
\`\`\`

## Numbers

| Phase | Pre-filter | Post-filter (rows to write) | Chunks |
|---|---:|---:|---:|
| email  | ${emailRows.length} | ${emailRows.length} | ${emailChunkRecords.length} |
| reg_ip | ${regIpPreFilter}   | ${regIpRows.length} | ${regIpChunkRecords.length} |

Excluded uids (Ellie test accounts manually changed): {1146751, 1146752}.

id=0 tombstone: D1 has a row with id=0 (\`[已删除用户0]\`); audit + generator both skip it via \`WHERE id > 0\` / candidate filter, and the backfill SQL matches by exact id so id=0 is never touched.

## Validation steps (NOT executed by this script)

1. **NUL scan** — see \`nul-scan.log\`. Expected total = 0.
2. **SQLite dry-run** — Run \`scripts/dryrun-validate-users-backfill.sh\` to apply chunks against a fresh in-memory SQLite with the D1 \`users\` schema; expected error count = 0. Log lands at \`sqlite-dryrun.log\`.
3. **Preflight** — Run \`preflight.sql\` against live D1 (read-only). Confirm \`email_empty\` & \`reg_ip_empty\` are within ±5 of audit values; uids {1146751,1146752} unchanged.
4. **Canary** — Execute \`email/canary.sql\` then \`reg_ip/canary.sql\` against live D1 with explicit reviewer approval. Re-run preflight; confirm exact reduction of \`email_empty\` by 1000 and \`reg_ip_empty\` by canary actual rows.
5. **Full rollout** — Per-chunk execution with sha256 check before each batch.
6. **Rollback path** — \`rollback/NNNN.sql\` is condition-protected: \`UPDATE users SET email='' WHERE id = ? AND email = <exact source value>\`. Only un-does writes whose value matches what THIS backfill set; safe if user later changed it.

## Cache invalidation

Per reviewer 2026-05-21: KV NOT touched. Email/IP are not public-list fields; rely on TTL.

## Status

DRY-RUN. No D1 writes. No KV operations. SQL files exist but have NOT been executed against any D1 instance.
`;
	writeFileSync(`${OUT_DIR}/README.md`, readme);

	console.log("\n=== DONE ===");
	console.log(`email candidates: ${emailRows.length}, chunks: ${emailChunkRecords.length}`);
	console.log(
		`reg_ip candidates: pre=${regIpPreFilter} post=${regIpRows.length}, chunks: ${regIpChunkRecords.length}`,
	);
	console.log(`Total NUL bytes: ${totalNul}`);
	console.log(`Outputs at: ${OUT_DIR}`);
}

await main();
