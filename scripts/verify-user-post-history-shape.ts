#!/usr/bin/env bun
/**
 * scripts/verify-user-post-history-shape.ts
 *
 * Pre-deploy verification for `/api/v1/users/:id/posts`.
 *
 * The user-profile 回复 tab depends on the Worker returning the new
 * `UserPostHistoryItem` shape (`{ post, thread }`). Until that endpoint is
 * deployed, the web build renders a "Worker 接口未同步" error in the 回复
 * tab. Run this script against `$WORKER_API_URL` after deploying the Worker
 * to confirm the upgrade actually took effect.
 *
 * Required env:
 *   WORKER_API_URL   — base URL of the Worker (e.g. https://ellie.worker.hexly.ai)
 *
 * Optional env:
 *   FORUM_API_KEY    — `x-api-key` for protected envs (mirrors web env)
 *   USER_ID          — user id to probe (default 1; switch if user has zero replies)
 *
 * Exits 0 on shape match, 1 on shape mismatch or transport error, 2 if the
 * data array is empty (ambiguous — ask the caller to try another user).
 */

const baseUrl = process.env.WORKER_API_URL;
if (!baseUrl) {
	console.error("[verify] WORKER_API_URL is required");
	process.exit(1);
}

const userId = Number.parseInt(process.env.USER_ID ?? "1", 10);
if (!Number.isFinite(userId) || userId <= 0) {
	console.error(`[verify] USER_ID is not a positive integer: ${process.env.USER_ID}`);
	process.exit(1);
}

const url = `${baseUrl.replace(/\/$/, "")}/api/v1/users/${userId}/posts?limit=1`;
const headers: Record<string, string> = { accept: "application/json" };
if (process.env.FORUM_API_KEY) headers["x-api-key"] = process.env.FORUM_API_KEY;

console.log(`[verify] GET ${url}`);

let res: Response;
try {
	res = await fetch(url, { headers });
} catch (err) {
	console.error(`[verify] transport error: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
}

if (!res.ok) {
	console.error(`[verify] HTTP ${res.status} ${res.statusText}`);
	const body = await res.text();
	console.error(body.slice(0, 500));
	process.exit(1);
}

const payload: unknown = await res.json();
if (!payload || typeof payload !== "object" || !("data" in payload)) {
	console.error("[verify] response missing `data` field");
	console.error(JSON.stringify(payload).slice(0, 500));
	process.exit(1);
}
const data = (payload as { data?: unknown }).data;
if (!Array.isArray(data)) {
	console.error("[verify] `data` is not an array");
	process.exit(1);
}

if (data.length === 0) {
	console.warn(
		`[verify] data array is empty for USER_ID=${userId}; cannot determine shape. Re-run with a USER_ID that has at least one reply.`,
	);
	process.exit(2);
}

const sample = data[0];
const isHistory =
	!!sample &&
	typeof sample === "object" &&
	"post" in sample &&
	"thread" in sample &&
	typeof (sample as { post?: { id?: unknown } }).post?.id === "number" &&
	typeof (sample as { thread?: { subject?: unknown } }).thread?.subject === "string";

if (!isHistory) {
	console.error("[verify] FAIL — Worker still returns legacy `Post[]` shape.");
	console.error("[verify] expected: { post: { id, createdAt, ... }, thread: { subject, ... } }");
	console.error("[verify] got:");
	console.error(JSON.stringify(sample, null, 2).slice(0, 800));
	process.exit(1);
}

console.log("[verify] OK — Worker returns UserPostHistoryItem shape.");
console.log(`[verify] sample post.id = ${(sample as { post: { id: number } }).post.id}`);
console.log(
	`[verify] sample thread.subject = ${JSON.stringify((sample as { thread: { subject: string } }).thread.subject)}`,
);
process.exit(0);
