#!/usr/bin/env bun
/**
 * Read-only typeid coverage stats for the 5/14 dump.
 *
 * Why this is separate from `fill-threads-from-dump.ts`:
 *   loader runs once, stats stay on stdout (not persisted), and we don't
 *   want to truncate-rerun the loader just to get these numbers. This
 *   script re-streams the dump and tallies (forum_id, source_typeid) raw
 *   coverage against the synthetic-id map already in the dry-run DB.
 *
 * Output (stdout):
 *   - rawTotal, rawSourceTypeidPositive
 *   - mapped (raw>0 AND synthetic id known)
 *   - unmapped (raw>0 AND no synthetic id)
 *   - distinct (forum_id, source_typeid) pairs raw>0
 *   - top-10 unmapped (forum_id, source_typeid) by count
 */

import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseInsertLine } from "../packages/migrate/src/extract/parser";

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		db: { type: "string" },
		dump: { type: "string" },
	},
});

const DB_PATH = values.db ?? "output/dry-run-2026-05-14-thread-types/ellie.db";
const DUMP_PATH = values.dump ?? "reference/db/2026-05-14/db_tongji_main_full.sql.gz";

if (!existsSync(DB_PATH)) {
	console.error(`Error: ellie.db not found at ${DB_PATH}`);
	process.exit(1);
}
if (!existsSync(DUMP_PATH)) {
	console.error(`Error: dump not found at ${DUMP_PATH}`);
	process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

// (fid → source_typeid → synthetic id)
const syntheticIdMap = new Map<number, Map<number, number>>();
interface FthRow {
	id: number;
	forum_id: number;
	source_typeid: number;
}
const fthRows = db
	.query<FthRow, []>(
		"SELECT id, forum_id, source_typeid FROM forum_thread_types WHERE source_typeid > 0",
	)
	.all();
for (const r of fthRows) {
	let bucket = syntheticIdMap.get(r.forum_id);
	if (!bucket) {
		bucket = new Map();
		syntheticIdMap.set(r.forum_id, bucket);
	}
	bucket.set(r.source_typeid, r.id);
}
console.log(
	`[maps] synthetic-id forums = ${syntheticIdMap.size}, total positive fth rows = ${fthRows.length}`,
);

async function* streamLines(path: string): AsyncGenerator<string> {
	const child = spawn("gunzip", ["-c", path], { stdio: ["ignore", "pipe", "inherit"] });
	const stdout = child.stdout;
	if (!stdout) throw new Error("gunzip stdout not available");
	let buf = "";
	for await (const chunk of stdout) {
		buf += (chunk as Buffer).toString("utf8");
		let nl = buf.indexOf("\n");
		while (nl >= 0) {
			yield buf.substring(0, nl);
			buf = buf.substring(nl + 1);
			nl = buf.indexOf("\n");
		}
	}
	if (buf.length > 0) yield buf;
	await new Promise<void>((resolve, reject) => {
		child.on("exit", (code) => {
			if (code === 0 || code === null) resolve();
			else reject(new Error(`gunzip exited with code ${code}`));
		});
		child.on("error", reject);
	});
}

let rawTotal = 0;
let rawSourceTypeidPositive = 0;
let mapped = 0;
let unmapped = 0;
const distinctPositive = new Set<string>(); // "fid:stid"
const rawPairCounts = new Map<string, { fid: number; stid: number; count: number }>();
const unmappedCounts = new Map<string, { fid: number; stid: number; count: number }>();

async function scanTable(table: string): Promise<void> {
	const prefix = `INSERT INTO \`${table}\` VALUES `;
	const t0 = Date.now();
	let tableRows = 0;
	for await (const line of streamLines(DUMP_PATH)) {
		if (!line.startsWith(prefix)) continue;
		const rows = parseInsertLine(line, table);
		for (const row of rows) {
			rawTotal++;
			tableRows++;
			const fid = Number(row[1]) || 0;
			const stid = Number(row[3]) || 0;
			if (stid <= 0) continue;
			rawSourceTypeidPositive++;
			const key = `${fid}:${stid}`;
			distinctPositive.add(key);
			let pair = rawPairCounts.get(key);
			if (!pair) {
				pair = { fid, stid, count: 0 };
				rawPairCounts.set(key, pair);
			}
			pair.count++;
			const synId = syntheticIdMap.get(fid)?.get(stid);
			if (synId && synId > 0) {
				mapped++;
			} else {
				unmapped++;
				let u = unmappedCounts.get(key);
				if (!u) {
					u = { fid, stid, count: 0 };
					unmappedCounts.set(key, u);
				}
				u.count++;
			}
		}
	}
	console.log(`  [${table}] ${tableRows} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

console.log(`[scan] reading ${DUMP_PATH} (read-only)`);
await scanTable("pre_forum_thread");
for (let i = 1; i <= 7; i++) {
	const t = `pre_forum_thread_${i}`;
	try {
		await scanTable(t);
	} catch (e) {
		console.log(`  [${t}] skipped (${(e as Error).message})`);
	}
}

console.log("\n[stats] raw source typeid coverage");
console.log(`  rawTotal                       = ${rawTotal}`);
console.log(`  rawSourceTypeidPositive        = ${rawSourceTypeidPositive}`);
console.log(`  mapped (synthetic id minted)   = ${mapped}`);
console.log(`  unmapped (raw>0, no synthetic) = ${unmapped}`);
console.log(`  distinct (fid, source_typeid) raw>0 pairs = ${distinctPositive.size}`);
console.log(`  distinct unmapped pairs        = ${unmappedCounts.size}`);

const topRaw = [...rawPairCounts.values()].sort((a, b) => b.count - a.count).slice(0, 10);
console.log("\n[stats] top 10 raw (fid, source_typeid) pairs by count");
for (const r of topRaw) {
	console.log(`  fid=${r.fid} stid=${r.stid} count=${r.count}`);
}

const topUnmapped = [...unmappedCounts.values()].sort((a, b) => b.count - a.count).slice(0, 10);
console.log("\n[stats] top 10 unmapped (fid, source_typeid) pairs by count");
for (const r of topUnmapped) {
	console.log(`  fid=${r.fid} stid=${r.stid} count=${r.count}`);
}

db.close();
console.log("\n[done] coverage stats complete");
