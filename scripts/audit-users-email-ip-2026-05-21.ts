#!/usr/bin/env bun
/**
 * Read-only audit: compare local 2026-05-20 MySQL dump vs D1 users
 * on email / reg_ip / last_ip fields.
 *
 * Inputs (no writes):
 *   - reference/db/2026-05-20/db_tongji_ucenter_full.sql.gz (uc_members)
 *   - reference/db/2026-05-20/db_tongji_main_full.sql.gz    (pre_common_member, pre_common_member_status)
 *   - live D1 (read-only paginated SELECT on users)
 *
 * Outputs (jsonl + json, NO execute SQL):
 *   - reference/sync-2026-05-20/users-audit/source/uc-members.jsonl
 *   - reference/sync-2026-05-20/users-audit/source/common-member.jsonl
 *   - reference/sync-2026-05-20/users-audit/source/common-member-status.jsonl
 *   - reference/sync-2026-05-20/users-audit/d1/users-{N}.jsonl  (page files)
 *   - reference/sync-2026-05-20/users-audit/report.json
 *   - reference/sync-2026-05-20/users-audit/diff-samples.json
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { rowsToObjects, streamParseMySQLDump } from "../scripts/import/stream-parse-dump";

const DUMP_DIR = "reference/db/2026-05-20";
const OUT_DIR = "reference/sync-2026-05-20/users-audit";
const SRC_DIR = `${OUT_DIR}/source`;
const D1_DIR = `${OUT_DIR}/d1`;

mkdirSync(SRC_DIR, { recursive: true });
mkdirSync(D1_DIR, { recursive: true });

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
	lastip: string;
	lastvisit: number;
	lastactivity: number;
}
interface D1User {
	id: number;
	email: string | null;
	reg_ip: string | null;
	last_ip: string | null;
	last_activity: number | null;
	last_login: number | null;
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
	console.log(`  rows=${objs.length}`);
	const out: T[] = [];
	for (const o of objs) out.push(pick(o));
	return out;
}

function writeJsonl<T>(path: string, items: T[]) {
	writeFileSync(path, "");
	const CHUNK = 5000;
	for (let i = 0; i < items.length; i += CHUNK) {
		const lines = items
			.slice(i, i + CHUNK)
			.map((x) => JSON.stringify(x))
			.join("\n");
		appendFileSync(path, `${lines}\n`);
	}
}

const norm = (v: string | null | undefined): string => {
	if (v === null || v === undefined) return "";
	return String(v).trim();
};
const lower = (v: string): string => v.toLowerCase();
const isEmpty = (v: string): boolean => v === "" || v === "0.0.0.0";

interface FieldStats {
	both_empty: number;
	source_only: number;
	d1_only_or_unverifiable: number;
	same: number;
	different: number;
}
function emptyStats(): FieldStats {
	return { both_empty: 0, source_only: 0, d1_only_or_unverifiable: 0, same: 0, different: 0 };
}

function classify(
	srcRaw: string | null | undefined,
	d1Raw: string | null | undefined,
	caseInsensitive: boolean,
): keyof FieldStats {
	const s = norm(srcRaw);
	const d = norm(d1Raw);
	const sEmpty = isEmpty(s);
	const dEmpty = isEmpty(d);
	if (sEmpty && dEmpty) return "both_empty";
	if (!sEmpty && dEmpty) return "source_only";
	if (sEmpty && !dEmpty) return "d1_only_or_unverifiable";
	const a = caseInsensitive ? lower(s) : s;
	const b = caseInsensitive ? lower(d) : d;
	return a === b ? "same" : "different";
}

interface DiffSample {
	id: number;
	field: "email" | "reg_ip" | "last_ip";
	source_uc: string | null;
	source_member: string | null;
	source_status: string | null;
	d1: string | null;
}

interface MemberEmailVsUcEmail {
	both_empty: number;
	uc_only: number;
	member_only: number;
	same: number;
	different: number;
	uid_in_uc_but_not_member: number;
	uid_in_member_but_not_uc: number;
}

interface SourceMaps {
	uc: Map<number, UCMember>;
	cm: Map<number, CommonMember>;
	st: Map<number, MemberStatus>;
}

interface SourceData {
	ucList: UCMember[];
	cmList: CommonMember[];
	stList: MemberStatus[];
	maps: SourceMaps;
	maxUid: number;
}

async function loadSources(): Promise<SourceData> {
	const ucList = await streamPick<UCMember>("db_tongji_ucenter_full.sql.gz", "uc_members", (o) => ({
		uid: Number(o.uid),
		email: (o.email as string) ?? "",
		regip: (o.regip as string) ?? "",
	}));
	writeJsonl(`${SRC_DIR}/uc-members.jsonl`, ucList);

	const cmList = await streamPick<CommonMember>(
		"db_tongji_main_full.sql.gz",
		"pre_common_member",
		(o) => ({
			uid: Number(o.uid),
			email: (o.email as string) ?? "",
		}),
	);
	writeJsonl(`${SRC_DIR}/common-member.jsonl`, cmList);

	const stList = await streamPick<MemberStatus>(
		"db_tongji_main_full.sql.gz",
		"pre_common_member_status",
		(o) => ({
			uid: Number(o.uid),
			regip: (o.regip as string) ?? "",
			lastip: (o.lastip as string) ?? "",
			lastvisit: Number(o.lastvisit ?? 0),
			lastactivity: Number(o.lastactivity ?? 0),
		}),
	);
	writeJsonl(`${SRC_DIR}/common-member-status.jsonl`, stList);

	const uc = new Map<number, UCMember>(ucList.map((u) => [u.uid, u]));
	const cm = new Map<number, CommonMember>(cmList.map((u) => [u.uid, u]));
	const st = new Map<number, MemberStatus>(stList.map((u) => [u.uid, u]));

	const reduceMax = (arr: { uid: number }[]): number =>
		arr.reduce((m, u) => (u.uid > m ? u.uid : m), 0);
	const maxUid = Math.max(reduceMax(ucList), reduceMax(cmList));
	console.log(`> source max uid = ${maxUid}`);
	return { ucList, cmList, stList, maps: { uc, cm, st }, maxUid };
}

function compareMemberVsUc(src: SourceData): {
	stats: MemberEmailVsUcEmail;
	samples: { uid: number; uc: string; member: string }[];
} {
	const stats: MemberEmailVsUcEmail = {
		both_empty: 0,
		uc_only: 0,
		member_only: 0,
		same: 0,
		different: 0,
		uid_in_uc_but_not_member: 0,
		uid_in_member_but_not_uc: 0,
	};
	const samples: { uid: number; uc: string; member: string }[] = [];
	const allUids = new Set<number>();
	for (const u of src.ucList) allUids.add(u.uid);
	for (const u of src.cmList) allUids.add(u.uid);
	for (const uid of allUids) {
		const uc = src.maps.uc.get(uid);
		const cm = src.maps.cm.get(uid);
		if (uc && !cm) {
			stats.uid_in_uc_but_not_member++;
			continue;
		}
		if (!uc && cm) {
			stats.uid_in_member_but_not_uc++;
			continue;
		}
		if (!uc || !cm) continue;
		const a = norm(uc.email);
		const b = norm(cm.email);
		const aEmpty = isEmpty(a);
		const bEmpty = isEmpty(b);
		if (aEmpty && bEmpty) {
			stats.both_empty++;
			continue;
		}
		if (!aEmpty && bEmpty) {
			stats.uc_only++;
			continue;
		}
		if (aEmpty && !bEmpty) {
			stats.member_only++;
			continue;
		}
		if (lower(a) === lower(b)) {
			stats.same++;
			continue;
		}
		stats.different++;
		if (samples.length < 20) samples.push({ uid, uc: a, member: b });
	}
	return { stats, samples };
}

function pickFirstNonEmpty(...vals: (string | undefined)[]): string {
	for (const v of vals) {
		if (v && !isEmpty(norm(v))) return v;
	}
	return "";
}

interface DiffState {
	emailStats: FieldStats;
	regIpStats: FieldStats;
	lastIpStats: FieldStats;
	ipv6InD1: { reg_ip: number; last_ip: number };
	lenGt15InD1: { reg_ip: number; last_ip: number };
	sourceRowMissing: { uc: number; cm: number; st: number };
	d1AboveSource: number;
	samples: Record<"email" | "reg_ip" | "last_ip", DiffSample[]>;
	// 71k subset: both `uc_members` and `pre_common_member` rows exist
	memberSubset: {
		count: number;
		both_email_nonempty: number;
		same: number;
		case_only_diff: number;
		different: number;
	};
}

function newDiffState(): DiffState {
	return {
		emailStats: emptyStats(),
		regIpStats: emptyStats(),
		lastIpStats: emptyStats(),
		ipv6InD1: { reg_ip: 0, last_ip: 0 },
		lenGt15InD1: { reg_ip: 0, last_ip: 0 },
		sourceRowMissing: { uc: 0, cm: 0, st: 0 },
		d1AboveSource: 0,
		samples: { email: [], reg_ip: [], last_ip: [] },
		memberSubset: {
			count: 0,
			both_email_nonempty: 0,
			same: 0,
			case_only_diff: 0,
			different: 0,
		},
	};
}

function pickSample(state: DiffState, s: DiffSample) {
	const arr = state.samples[s.field];
	if (arr.length < 20) arr.push(s);
}

function diffEmail(state: DiffState, u: D1User, uc?: UCMember, cm?: CommonMember) {
	const src = pickFirstNonEmpty(cm?.email, uc?.email);
	const cls = classify(src, u.email, true);
	state.emailStats[cls]++;
	if (cls === "different") {
		pickSample(state, {
			id: u.id,
			field: "email",
			source_uc: uc?.email ?? null,
			source_member: cm?.email ?? null,
			source_status: null,
			d1: u.email,
		});
	}
}

function diffRegIp(state: DiffState, u: D1User, uc?: UCMember, st?: MemberStatus) {
	const src = pickFirstNonEmpty(st?.regip, uc?.regip);
	const cls = classify(src, u.reg_ip, false);
	state.regIpStats[cls]++;
	const d1RegIp = norm(u.reg_ip ?? "");
	if (d1RegIp.includes(":")) state.ipv6InD1.reg_ip++;
	if (d1RegIp.length > 15) state.lenGt15InD1.reg_ip++;
	if (cls === "different") {
		pickSample(state, {
			id: u.id,
			field: "reg_ip",
			source_uc: uc?.regip ?? null,
			source_member: null,
			source_status: st?.regip ?? null,
			d1: u.reg_ip,
		});
	}
}

function diffLastIp(state: DiffState, u: D1User, st?: MemberStatus) {
	const src = st?.lastip ?? "";
	const cls = classify(src, u.last_ip, false);
	state.lastIpStats[cls]++;
	const d1LastIp = norm(u.last_ip ?? "");
	if (d1LastIp.includes(":")) state.ipv6InD1.last_ip++;
	if (d1LastIp.length > 15) state.lenGt15InD1.last_ip++;
	if (cls === "different") {
		pickSample(state, {
			id: u.id,
			field: "last_ip",
			source_uc: null,
			source_member: null,
			source_status: st?.lastip ?? null,
			d1: u.last_ip,
		});
	}
}

function trackMemberSubset(state: DiffState, uc: UCMember, cm: CommonMember) {
	state.memberSubset.count++;
	const a = norm(uc.email);
	const b = norm(cm.email);
	if (isEmpty(a) || isEmpty(b)) return;
	state.memberSubset.both_email_nonempty++;
	if (a === b) state.memberSubset.same++;
	else if (lower(a) === lower(b)) state.memberSubset.case_only_diff++;
	else state.memberSubset.different++;
}

function diffOne(state: DiffState, u: D1User, src: SourceData) {
	const uc = src.maps.uc.get(u.id);
	const cm = src.maps.cm.get(u.id);
	const st = src.maps.st.get(u.id);
	if (!uc) state.sourceRowMissing.uc++;
	if (!cm) state.sourceRowMissing.cm++;
	if (!st) state.sourceRowMissing.st++;
	if (uc && cm) trackMemberSubset(state, uc, cm);
	diffEmail(state, u, uc, cm);
	diffRegIp(state, u, uc, st);
	diffLastIp(state, u, st);
	if (u.id > src.maxUid) state.d1AboveSource++;
}

async function pullD1Page(afterId: number, limit: number): Promise<D1User[]> {
	const sql = `SELECT id, email, reg_ip, last_ip, last_activity, last_login FROM users WHERE id > ${afterId} ORDER BY id LIMIT ${limit}`;
	const out = execFileSync(
		"npx",
		[
			"wrangler",
			"d1",
			"execute",
			"tongjinet-db",
			"-c",
			"apps/worker/wrangler.toml",
			"--remote",
			"--command",
			sql,
			"--json",
		],
		{ encoding: "utf8", maxBuffer: 1024 * 1024 * 200 },
	);
	const parsed = JSON.parse(out);
	return parsed[0].results as D1User[];
}

interface ScanResult {
	state: DiffState;
	totalSeen: number;
	maxIdSeen: number;
	pages: number;
}

async function scanD1(src: SourceData): Promise<ScanResult> {
	const state = newDiffState();
	const PAGE = 10000;
	let afterId = 0;
	let totalSeen = 0;
	let pages = 0;
	while (true) {
		console.log(`> D1 page after id=${afterId}`);
		const page = await pullD1Page(afterId, PAGE);
		if (page.length === 0) break;
		pages++;
		writeJsonl(`${D1_DIR}/users-${String(pages).padStart(4, "0")}.jsonl`, page);
		for (const u of page) {
			totalSeen++;
			diffOne(state, u, src);
		}
		afterId = page[page.length - 1].id;
		if (page.length < PAGE) break;
		await new Promise((r) => setTimeout(r, 200));
	}
	return { state, totalSeen, maxIdSeen: afterId, pages };
}

async function main() {
	const startedAt = new Date().toISOString();
	const src = await loadSources();
	const memberVsUc = compareMemberVsUc(src);
	const scan = await scanD1(src);

	const report = {
		started_at: startedAt,
		finished_at: new Date().toISOString(),
		baseline_d1: {
			users_max_id: 1146872,
			users_count: 1142569,
		},
		source: {
			dump_dir: DUMP_DIR,
			uc_members: src.ucList.length,
			pre_common_member: src.cmList.length,
			pre_common_member_status: src.stList.length,
			max_uid_uc: src.ucList.reduce((m, u) => (u.uid > m ? u.uid : m), 0),
			max_uid_member: src.cmList.reduce((m, u) => (u.uid > m ? u.uid : m), 0),
			max_uid_status: src.stList.reduce((m, u) => (u.uid > m ? u.uid : m), 0),
		},
		d1: {
			users_seen: scan.totalSeen,
			max_id_seen: scan.maxIdSeen,
			pages: scan.pages,
		},
		member_email_vs_uc_email: memberVsUc.stats,
		field_diff: {
			email: scan.state.emailStats,
			reg_ip: scan.state.regIpStats,
			last_ip: scan.state.lastIpStats,
		},
		ipv6_in_d1: scan.state.ipv6InD1,
		len_gt_15_in_d1: scan.state.lenGt15InD1,
		source_row_missing: scan.state.sourceRowMissing,
		member_subset_email: scan.state.memberSubset,
		d1_above_source_max_uid: scan.state.d1AboveSource,
		notes: [
			"Source-owned candidate fields evaluated: email, reg_ip, last_ip ONLY.",
			"email source: prefer pre_common_member.email; fallback uc_members.email (case-insensitive after trim).",
			"reg_ip source: prefer pre_common_member_status.regip; fallback uc_members.regip.",
			"last_ip source: pre_common_member_status.lastip ONLY.",
			"Empty normalization treats '' and '0.0.0.0' as empty.",
			"`d1_only_or_unverifiable` = source empty AND D1 non-empty. Not interpreted as 'D1 newer'.",
			"`source_row_missing.{uc,cm,st}` counts uids where that source table has no row at all.",
			"`member_subset_email`: restricted to uids where BOTH `uc_members` and `pre_common_member` rows exist AND both emails are non-empty; reports same / case_only_diff / different.",
			"`len_gt_15_in_d1`: D1 reg_ip/last_ip values >15 chars (source CHAR(15) cannot represent these — e.g. IPv6, Cloudflare edge w/ subnet, x-forwarded chain).",
			"D1 IPv6 IP counts reported separately so reviewers see why 'different' is high.",
		],
	};
	writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2));
	writeFileSync(
		`${OUT_DIR}/diff-samples.json`,
		JSON.stringify(
			{
				member_email_vs_uc_email_samples: memberVsUc.samples,
				email_different: scan.state.samples.email,
				reg_ip_different: scan.state.samples.reg_ip,
				last_ip_different: scan.state.samples.last_ip,
			},
			null,
			2,
		),
	);

	console.log("\n=== REPORT ===");
	console.log(JSON.stringify(report, null, 2));
}

await main();
