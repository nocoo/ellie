import type { ForumVisibility } from "@ellie/types";
import type { Env } from "./env";
import { persistReadingSnapshot, restoreReadingSnapshot } from "./reading-snapshots";

export interface ForumGateRow {
	id: number;
	parent_id: number;
	status: number;
	visibility: ForumVisibility;
}

interface Snapshot {
	revision: string;
	rows: ForumGateRow[];
}

const STORAGE_TTL_MS = 30 * 86400_000;
const memory = new WeakMap<D1Database, Snapshot>();
const REVISION_SQL = "SELECT revision FROM forum_authority_revision WHERE id = 1";
const ROWS_SQL = "SELECT id, parent_id, status, visibility FROM forums";

function valid(value: unknown, revision: string): value is Snapshot {
	if (!value || typeof value !== "object") return false;
	const snapshot = value as Snapshot;
	return (
		snapshot.revision === revision &&
		Array.isArray(snapshot.rows) &&
		snapshot.rows.length <= 2048 &&
		snapshot.rows.every(
			(row) =>
				row &&
				Number.isSafeInteger(row.id) &&
				row.id > 0 &&
				Number.isSafeInteger(row.parent_id) &&
				row.parent_id >= 0 &&
				Number.isSafeInteger(row.status) &&
				["public", "members", "staff", "admin"].includes(row.visibility),
		) &&
		new Set(snapshot.rows.map((row) => row.id)).size === snapshot.rows.length
	);
}

export async function loadHomeForumRows(env: Env): Promise<ForumGateRow[]> {
	const current = await env.DB.prepare(REVISION_SQL).first<{ revision: string }>();
	if (!current || !/^[a-f0-9]{32}$/.test(current.revision))
		throw new Error("Home forums revision could not be loaded");
	const cached = memory.get(env.DB);
	if (cached?.revision === current.revision) return cached.rows;
	const key = (revision: string) => `home:authority:v1:${revision}`;
	const stored = await restoreReadingSnapshot(
		env,
		key(current.revision),
		STORAGE_TTL_MS,
		(value): value is Snapshot => valid(value, current.revision),
		null,
	);
	if (stored) {
		memory.set(env.DB, stored.data);
		return stored.data.rows;
	}
	// D1 batch keeps the revision and rows in one transaction, even during admin changes.
	const [version, forums] = await env.DB.batch([
		env.DB.prepare(REVISION_SQL),
		env.DB.prepare(ROWS_SQL),
	]);
	const snapshot = {
		revision: (version.results[0] as { revision: string } | undefined)?.revision,
		rows: forums.results,
	};
	if (
		!version.success ||
		!forums.success ||
		!snapshot.revision ||
		!/^[a-f0-9]{32}$/.test(snapshot.revision) ||
		!valid(snapshot, snapshot.revision)
	)
		throw new Error("Home forums could not be loaded");
	memory.set(env.DB, snapshot);
	await persistReadingSnapshot(env, key(snapshot.revision), STORAGE_TTL_MS, snapshot);
	return snapshot.rows;
}
