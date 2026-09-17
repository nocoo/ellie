import type { SQLInputValue } from "node:sqlite";
import type { CacheDescriptor, CacheEnvelope, User, UserCheckin } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { me as readSelf } from "../../../../src/handlers/auth";
import * as checkin from "../../../../src/handlers/checkin";
import { updateProfile } from "../../../../src/handlers/me";
import * as message from "../../../../src/handlers/message";
import * as post from "../../../../src/handlers/post";
import * as thread from "../../../../src/handlers/thread";
import { invalidateUserCaches } from "../../../../src/lib/cache/invalidate";
import { pmUserGenKey } from "../../../../src/lib/cache/keys";
import {
	getMailbox,
	getMessages,
	getPrivateData,
	getUnreadCount,
	isPrivateCacheData,
	loadMessageAccess,
	type PostingPreview,
	privateCacheKey,
	rebuildPrivateCache,
	validatePrivateCacheDescriptor,
} from "../../../../src/lib/cache/private-read";
import { createJwtForRole } from "../../../helpers";
import { deferred, readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
let tokens: Map<number, string>;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-17T04:00:00Z"));
	f = readingFixture();
	f.thread(1);
	f.post(1);
	insertMessage(1);
	f.insert("user_checkins", {
		user_id: 10,
		total_days: 10,
		month_days: 3,
		streak_days: 2,
		reward_total: 500,
		last_reward: 50,
		mood: "kx",
		message: "Yesterday",
		last_checkin_at: Math.floor(Date.now() / 1000) - 86400,
	});
	tokens = new Map(
		await Promise.all([10, 20, 30].map(async (id) => [id, await createJwtForRole(0, id)] as const)),
	);
});

afterEach(() => {
	f.close();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function insertMessage(id: number, overrides: Record<string, SQLInputValue> = {}) {
	f.insert("messages", {
		id,
		sender_id: 20,
		sender_name: "bob",
		receiver_id: 10,
		receiver_name: "alice",
		subject: `Subject ${id}`,
		content: `Private body ${id}`,
		created_at: id,
		...overrides,
	});
}

function descriptor(
	family: string,
	userId = 10,
	params: CacheDescriptor["params"] = {},
): CacheDescriptor {
	return { family, scope: `user:${userId}`, params: { userId, ...params } };
}

function mailbox(userId = 10, box = "inbox", limit = 20): CacheDescriptor {
	return descriptor("pm:list", userId, { box, limit, cursorTime: null, cursorId: null });
}

function families(userId = 10): CacheDescriptor[] {
	return [
		descriptor("user:self", userId),
		descriptor("user:checkin", userId),
		descriptor("user:posting-preview", userId, { action: "message" }),
		mailbox(userId),
		descriptor("pm:entity", userId, { id: 1 }),
		descriptor("pm:unread", userId),
	];
}

function request(userId: number, path: string, method = "GET", body?: unknown): Request {
	return new Request(`https://example.com/api/v1/${path}`, {
		method,
		headers: { Authorization: `Bearer ${tokens.get(userId)}`, "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

async function snapshot(d: CacheDescriptor) {
	const key = await privateCacheKey(f.env, d);
	const raw = f.values.get(key);
	expect(raw).toBeDefined();
	return { key, envelope: JSON.parse(raw as string) as CacheEnvelope };
}

describe("private reading snapshots with real SQL", () => {
	it("a mailbox hot read spends only current account and ownership SELECTs", async () => {
		insertMessage(2);
		const cold = await message.list(request(10, "messages"), f.env);
		expect(cold.status).toBe(200);
		const first = await cold.json();
		expect(first.data.map((row: { id: number }) => row.id)).toEqual([2, 1]);
		expect(first.meta.unreadCount).toBe(2);
		expect(f.calls).toHaveLength(5); // account, membership, unread, access, batched bodies
		f.calls.length = 0;
		const hot = await (await message.list(request(10, "messages"), f.env)).json();
		expect(hot.data).toEqual(first.data);
		expect(hot.meta).toMatchObject({ nextCursor: first.meta.nextCursor, unreadCount: 2 });
		expect(hot.meta.requestId).not.toBe(first.meta.requestId);
		expect(f.calls).toHaveLength(2);
		expect(f.calls.every((call) => !call.sql.includes("content"))).toBe(true);
		expect(f.calls.some((call) => call.mode === "run")).toBe(false);
	});

	it("loads only missing bodies across more than 100 messages and batches both KV and D1", async () => {
		for (let id = 2; id <= 205; id++) insertMessage(id);
		const warmed = [1, 100, 205];
		await getMessages(f.env, undefined, 10, warmed);
		f.calls.length = 0;
		vi.mocked(f.env.KV.get).mockClear();
		const ids = Array.from({ length: 205 }, (_, i) => i + 1);
		expect((await getMessages(f.env, undefined, 10, [...ids, 1, 100])).size).toBe(205);
		expect(f.calls.map((call) => call.params.length)).toEqual([100, 100, 8]);
		expect(f.calls.every((call) => call.params.slice(-2).every((id) => id === 10))).toBe(true);
		expect(
			f.calls
				.flatMap((call) => call.params.slice(0, -2))
				.filter((id) => warmed.includes(Number(id))),
		).toEqual([]);
		const bulkKeys = vi
			.mocked(f.env.KV.get)
			.mock.calls.map(([key]) => key)
			.filter(Array.isArray);
		expect(bulkKeys.map((keys) => keys.length)).toEqual([100, 100, 5]);
		f.calls.length = 0;
		await getMessages(f.env, undefined, 10, ids);
		expect(f.calls).toHaveLength(0);
		await loadMessageAccess(f.env, [...ids, 1]);
		expect(f.calls.map((call) => call.params.length)).toEqual([100, 100, 5]);
	});

	it("concurrent same-account reads share one genuinely pending batched body query", async () => {
		insertMessage(2);
		const entered = deferred();
		const release = deferred();
		f.state.afterRead = async (sql) => {
			if (sql.startsWith("SELECT id, sender_id, sender_name")) {
				entered.resolve();
				await release.promise;
			}
		};
		const readers = Array.from({ length: 100 }, () => getMessages(f.env, undefined, 10, [1, 2]));
		await entered.promise;
		readers.push(getMessages(f.env, undefined, 10, [1, 2]));
		release.resolve();
		expect(
			(await Promise.all(readers)).every(
				(rows) => rows.size === 2 && rows.get(1)?.content === "Private body 1",
			),
		).toBe(true);
		expect(f.calls).toHaveLength(1);
	});

	it.each([1, 17, 99, 100])(
		"inbox/outbox pages, cursor ties and legal limit %i remain independent",
		async (limit) => {
			for (let id = 2; id <= 105; id++) insertMessage(id, { created_at: Math.floor(id / 3) });
			insertMessage(106, {
				sender_id: 10,
				sender_name: "alice",
				receiver_id: 20,
				receiver_name: "bob",
			});
			const expected = f.sqlite
				.prepare("SELECT id FROM messages WHERE receiver_id = 10 ORDER BY created_at DESC, id DESC")
				.all()
				.map((row) => row.id);
			const ids: number[] = [];
			let cursor: string | null = null;
			do {
				const path = `messages?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
				const response = await message.list(request(10, path), f.env);
				const body = await response.json();
				expect(response.status).toBe(200);
				ids.push(...body.data.map((row: { id: number }) => row.id));
				cursor = body.meta.nextCursor;
				f.calls.length = 0;
				const repeated = await (await message.list(request(10, path), f.env)).json();
				expect(repeated.data).toEqual(body.data);
				expect(repeated.meta).toMatchObject({
					nextCursor: cursor,
					unreadCount: body.meta.unreadCount,
				});
				expect(f.calls).toHaveLength(2);
			} while (cursor);
			expect(ids).toEqual(expected);
			const outbox = await (await message.list(request(10, "messages?box=outbox"), f.env)).json();
			expect(outbox.data.map((row: { id: number }) => row.id)).toEqual([106]);
			expect(outbox.meta).not.toHaveProperty("unreadCount");
		},
	);

	it.each([
		"user:self",
		"user:checkin",
		"user:posting-preview",
		"pm:list",
		"pm:entity",
		"pm:unread",
	])("%s hits without D1 or renewal until exactly 60 seconds", async (family) => {
		const d = families().find((entry) => entry.family === family) as CacheDescriptor;
		const expected = await getPrivateData(f.env, undefined, d);
		const { key, envelope } = await snapshot(d);
		expect(envelope).toMatchObject({ ...d, schemaVersion: 3, tier: "SHORT" });
		expect(envelope.expiresAt - envelope.loadedAt).toBe(60_000);
		f.calls.length = 0;
		vi.setSystemTime(envelope.expiresAt - 1);
		expect(await getPrivateData(f.env, undefined, d)).toEqual(expected);
		expect(f.calls).toHaveLength(0);
		expect(JSON.parse(f.values.get(key) as string)).toEqual(envelope);
		vi.setSystemTime(envelope.expiresAt);
		await getPrivateData(f.env, undefined, d);
		expect(f.calls.length).toBeGreaterThan(0);
		expect((await snapshot(d)).envelope.loadedAt).toBe(envelope.expiresAt);
	});

	it("a missing message is SHORT for exactly that account, not another participant", async () => {
		expect((await getMessages(f.env, undefined, 10, [90])).size).toBe(0);
		const { envelope } = await snapshot(descriptor("pm:entity", 10, { id: 90 }));
		expect(envelope).toMatchObject({
			data: null,
			scope: "user:10",
			tier: "SHORT",
			params: { userId: 10, id: 90 },
		});
		insertMessage(90);
		f.calls.length = 0;
		expect((await getMessages(f.env, undefined, 10, [90])).size).toBe(0);
		expect(f.calls).toHaveLength(0);
		expect((await getMessages(f.env, undefined, 20, [90])).get(90)?.content).toBe(
			"Private body 90",
		);
		vi.setSystemTime(envelope.expiresAt);
		expect((await getMessages(f.env, undefined, 10, [90])).get(90)?.content).toBe(
			"Private body 90",
		);
	});

	it.each(["user:self", "user:checkin"])(
		"%s null entries expire at 60 seconds and remain scoped to the missing account",
		async (family) => {
			const userId = family === "user:self" ? 90 : 20;
			const d = descriptor(family, userId);
			expect(await getPrivateData(f.env, undefined, d)).toBeNull();
			const { envelope } = await snapshot(d);
			expect(envelope).toMatchObject({ data: null, tier: "SHORT", scope: `user:${userId}` });
			if (family === "user:self") f.insert("users", { id: 90, username: "late" });
			else
				f.insert("user_checkins", {
					user_id: 20,
					mood: "kx",
					message: "New",
					last_checkin_at: Math.floor(Date.now() / 1000),
				});
			vi.setSystemTime(envelope.expiresAt - 1);
			f.calls.length = 0;
			expect(await getPrivateData(f.env, undefined, d)).toBeNull();
			expect(f.calls).toHaveLength(0);
			expect(await getPrivateData(f.env, undefined, descriptor(family))).not.toBeNull();
			vi.setSystemTime(envelope.expiresAt);
			expect(await getPrivateData(f.env, undefined, d)).not.toBeNull();
		},
	);

	it.each([
		"user:self",
		"user:checkin",
		"user:posting-preview",
		"pm:list",
		"pm:entity",
		"pm:unread",
	])("D1 errors for %s cannot become a cached null or empty result", async (family) => {
		const d = families().find((entry) => entry.family === family) as CacheDescriptor;
		const key = await privateCacheKey(f.env, d);
		f.state.afterRead = async () => {
			throw new Error("D1 unavailable");
		};
		await expect(getPrivateData(f.env, undefined, d)).rejects.toThrow("D1 unavailable");
		expect(f.values.has(key)).toBe(false);
		f.state.afterRead = undefined;
		expect(await getPrivateData(f.env, undefined, d)).not.toBeNull();
	});

	it.each(["pm:list", "pm:entity", "batched bodies", "access"])(
		"rejects false-success D1 results in %s",
		async (kind) => {
			const read = () =>
				kind === "access"
					? loadMessageAccess(f.env, [1])
					: kind === "batched bodies"
						? getMessages(f.env, undefined, 10, [1])
						: getPrivateData(
								f.env,
								undefined,
								kind === "pm:list" ? mailbox() : descriptor("pm:entity", 10, { id: 1 }),
							);
			f.state.queryError = true;
			await expect(read()).rejects.toThrow(/could not be loaded/);
			expect(f.snapshots("pm:list")).toEqual([]);
			expect(f.snapshots("pm:entity")).toEqual([]);
			f.state.queryError = false;
			await expect(read()).resolves.toBeDefined();
		},
	);

	it("rejects wrong-account bodies and envelopes and never exposes another account's profile", async () => {
		const pm = descriptor("pm:entity", 10, { id: 1 });
		await getMessages(f.env, undefined, 10, [1]);
		const { key, envelope } = await snapshot(pm);
		const otherBody = {
			...(envelope.data as object),
			receiver_id: 30,
			content: "Other account secret",
		};
		f.values.set(key, JSON.stringify({ ...envelope, data: otherBody }));
		expect(isPrivateCacheData(pm, otherBody)).toBe(false);
		f.calls.length = 0;
		expect((await getMessages(f.env, undefined, 10, [1])).get(1)?.content).toBe("Private body 1");
		expect(f.calls).toHaveLength(1);
		f.values.set(
			key,
			JSON.stringify({
				...envelope,
				scope: "user:30",
				data: { ...(envelope.data as object), content: "Wrong scope secret" },
			}),
		);
		expect((await getMessages(f.env, undefined, 10, [1])).get(1)?.content).toBe("Private body 1");
		expect((await getMessages(f.env, undefined, 30, [1])).size).toBe(0);
		const self = descriptor("user:self");
		await getPrivateData(f.env, undefined, self);
		const own = await snapshot(self);
		f.values.set(
			own.key,
			JSON.stringify({
				...own.envelope,
				data: { ...(own.envelope.data as object), id: 20, email: "bob@example.com" },
			}),
		);
		expect(await getPrivateData(f.env, undefined, self)).toMatchObject({
			id: 10,
			username: "alice",
			email: "",
		});
	});

	it.each(["user:checkin", "pm:entity"])(
		"%s rejects a cached row belonging to a different user or message ID",
		async (family) => {
			const d = descriptor(family, 10, family === "pm:entity" ? { id: 1 } : {});
			const expected = await getPrivateData(f.env, undefined, d);
			const { key, envelope } = await snapshot(d);
			const data = { ...(envelope.data as object), [family === "pm:entity" ? "id" : "userId"]: 20 };
			expect(isPrivateCacheData(d, data)).toBe(false);
			f.values.set(key, JSON.stringify({ ...envelope, data }));
			f.calls.length = 0;
			expect(await getPrivateData(f.env, undefined, d)).toEqual(expected);
			expect(f.calls).toHaveLength(1);
		},
	);

	it.each([
		["ban", "UPDATE users SET status = -1 WHERE id = 10", 403],
		[
			"deleted account",
			"DELETE FROM posts; DELETE FROM threads; DELETE FROM user_checkins; DELETE FROM messages; DELETE FROM users WHERE id = 10",
			404,
		],
		["changed owner", "UPDATE messages SET receiver_id = 30 WHERE id = 1", 404],
		["receiver deletion", "UPDATE messages SET receiver_deleted = 1 WHERE id = 1", 404],
		["hard deletion", "DELETE FROM messages WHERE id = 1", 404],
	] as const)("a cached private body cannot bypass current %s", async (_kind, sql, status) => {
		await getMessages(f.env, undefined, 10, [1]);
		f.sqlite.exec(sql);
		f.calls.length = 0;
		const response = await message.getById(request(10, "messages/1"), f.env);
		expect(response.status).toBe(status);
		expect(await response.text()).not.toContain("Private body");
		expect(f.calls.some((call) => call.sql.includes("content") || call.mode === "run")).toBe(false);
	});

	it("current ownership, mailbox and read-state override cached list membership/body flags", async () => {
		insertMessage(2);
		await message.list(request(10, "messages"), f.env);
		f.sqlite.exec(
			"UPDATE messages SET is_read = 1 WHERE id = 1; UPDATE messages SET receiver_id = 30 WHERE id = 2",
		);
		f.calls.length = 0;
		const body = await (await message.list(request(10, "messages"), f.env)).json();
		expect(body.data).toEqual([expect.objectContaining({ id: 1, isRead: true })]);
		expect(f.calls).toHaveLength(2);
		f.sqlite.exec("UPDATE messages SET receiver_deleted = 1 WHERE id = 1");
		expect((await (await message.list(request(10, "messages"), f.env)).json()).data).toEqual([]);
	});

	it("rebuilds all six private families with no KV I/O or mark-read side effects", async () => {
		for (const d of families()) {
			const value = await rebuildPrivateCache(f.env, undefined, d);
			expect(isPrivateCacheData(d, value), d.family).toBe(true);
		}
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();
		expect(f.calls.every((call) => call.mode !== "run")).toBe(true);
		expect(f.sqlite.prepare("SELECT is_read FROM messages WHERE id = 1").get()?.is_read).toBe(0);
		f.calls.length = 0;
		for (const d of [
			{ ...mailbox(), scope: "user:20" },
			descriptor("pm:entity", 10, { id: 1, credential: "secret" }),
			descriptor("pm:entity", 10, { id: "1 OR 1=1" }),
			descriptor("pm:list", 10, { ...mailbox().params, limit: 101 }),
			descriptor("pm:list", 10, { ...mailbox().params, cursorId: 1, cursorTime: null }),
			descriptor("user:posting-preview", 10, { action: "delete" }),
			descriptor("unknown"),
		]) {
			expect(() => validatePrivateCacheDescriptor(d)).toThrow();
			await expect(rebuildPrivateCache(f.env, undefined, d)).rejects.toThrow();
		}
		expect(f.calls).toHaveLength(0);
	});
});

function pmEpochWrites() {
	return vi
		.mocked(f.env.KV.put)
		.mock.calls.map(([key]) => key)
		.filter((key) => [pmUserGenKey(10), pmUserGenKey(20), pmUserGenKey(30)].includes(key));
}

describe("private reading mutations and current gates", () => {
	it("sender reads never mark read; receiver transitions once and sender sees current flags on a hot body", async () => {
		await message.list(request(20, "messages?box=outbox"), f.env);
		await getUnreadCount(f.env, undefined, 10);
		vi.mocked(f.env.KV.put).mockClear();
		f.calls.length = 0;
		expect(
			(await (await message.getById(request(20, "messages/1"), f.env)).json()).data.isRead,
		).toBe(false);
		expect(f.calls).toHaveLength(2);
		expect(pmEpochWrites()).toEqual([]);
		const receiver = await message.getById(request(10, "messages/1"), f.env);
		expect((await receiver.json()).data.isRead).toBe(true);
		expect(pmEpochWrites()).toEqual([pmUserGenKey(10)]);
		await message.getById(request(10, "messages/1"), f.env);
		await message.getById(request(10, "messages/1"), f.env);
		expect(
			f.calls.filter((call) => call.sql.startsWith("UPDATE messages SET is_read")),
		).toHaveLength(1);
		expect(pmEpochWrites()).toEqual([pmUserGenKey(10)]);
		expect(await getUnreadCount(f.env, undefined, 10)).toEqual({ count: 0 });
		f.calls.length = 0;
		const sender = await message.list(request(20, "messages?box=outbox"), f.env);
		expect((await sender.json()).data[0].isRead).toBe(true);
		expect(f.calls).toHaveLength(2);
	});

	it("concurrent receiver requests perform one read transition and one receiver epoch change", async () => {
		f.sqlite.exec(`CREATE TABLE read_events (id INTEGER);
			CREATE TRIGGER record_message_read AFTER UPDATE OF is_read ON messages
			WHEN OLD.is_read = 0 AND NEW.is_read = 1 BEGIN INSERT INTO read_events VALUES (NEW.id); END`);
		const entered = deferred();
		const release = deferred();
		let readers = 0;
		f.state.afterRead = async (sql) => {
			if (sql.startsWith("SELECT id, sender_id, receiver_id, is_read")) {
				if (++readers === 16) entered.resolve();
				await release.promise;
			}
		};
		const reading = Promise.all(
			Array.from({ length: 16 }, () => message.getById(request(10, "messages/1"), f.env)),
		);
		await entered.promise;
		release.resolve();
		const responses = await reading;
		for (const response of responses) expect((await response.json()).data.isRead).toBe(true);
		expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM read_events").get()?.n).toBe(1);
		expect(pmEpochWrites()).toEqual([pmUserGenKey(10)]);
	});

	it("send refreshes both participants' PM keys; deletion refreshes only the deleting participant", async () => {
		const before = await Promise.all([
			privateCacheKey(f.env, mailbox(10)),
			privateCacheKey(f.env, mailbox(20, "outbox")),
		]);
		await getMailbox(f.env, undefined, mailbox(10));
		await getMailbox(f.env, undefined, mailbox(20, "outbox"));
		await getUnreadCount(f.env, undefined, 10);
		const send = await message.create(
			request(20, "messages", "POST", { receiverId: 10, subject: "New", content: "New message" }),
			f.env,
		);
		expect(send.status).toBe(201);
		const id = (await send.json()).data.id;
		expect(pmEpochWrites().sort()).toEqual([pmUserGenKey(10), pmUserGenKey(20)].sort());
		expect(await privateCacheKey(f.env, mailbox(10))).not.toBe(before[0]);
		expect(await privateCacheKey(f.env, mailbox(20, "outbox"))).not.toBe(before[1]);
		expect((await getMailbox(f.env, undefined, mailbox(10))).items[0].id).toBe(id);
		expect((await getMailbox(f.env, undefined, mailbox(20, "outbox"))).items[0].id).toBe(id);
		expect(await getUnreadCount(f.env, undefined, 10)).toEqual({ count: 2 });
		vi.mocked(f.env.KV.put).mockClear();
		const senderKey = await privateCacheKey(f.env, mailbox(20, "outbox"));
		expect((await message.remove(request(10, `messages/${id}`, "DELETE"), f.env)).status).toBe(200);
		expect(pmEpochWrites()).toEqual([pmUserGenKey(10)]);
		expect(await privateCacheKey(f.env, mailbox(20, "outbox"))).toBe(senderKey);
		expect((await message.getById(request(10, `messages/${id}`), f.env)).status).toBe(404);
		expect((await message.getById(request(20, `messages/${id}`), f.env)).status).toBe(200);
		vi.mocked(f.env.KV.put).mockClear();
		expect((await message.remove(request(20, `messages/${id}`, "DELETE"), f.env)).status).toBe(200);
		expect(pmEpochWrites()).toEqual([pmUserGenKey(20)]);
		expect(
			f.sqlite
				.prepare("SELECT sender_deleted, receiver_deleted FROM messages WHERE id = ?")
				.get(id),
		).toMatchObject({ sender_deleted: 1, receiver_deleted: 1 });
		expect((await message.getById(request(20, `messages/${id}`), f.env)).status).toBe(404);
	});

	it.each([
		"UPDATE messages SET receiver_deleted = 1 WHERE id = 1",
		"UPDATE messages SET receiver_id = 30 WHERE id = 1",
	])(
		"a failed read transition rechecks the current gate before exposing a cached body: %s",
		async (sql) => {
			await getMessages(f.env, undefined, 10, [1]);
			f.state.beforeWrite = async (writing) => {
				if (writing.startsWith("UPDATE messages SET is_read")) f.sqlite.exec(sql);
			};
			const response = await message.getById(request(10, "messages/1"), f.env);
			expect(response.status).toBe(404);
			expect(await response.text()).not.toContain("Private body");
			expect(pmEpochWrites()).toEqual([]);
		},
	);

	it("mark-all-read invalidates the receiver's unread, entity and page generation together", async () => {
		insertMessage(2);
		await getMessages(f.env, undefined, 10, [1, 2]);
		await getMailbox(f.env, undefined, mailbox());
		await getUnreadCount(f.env, undefined, 10);
		const keys = await Promise.all([
			privateCacheKey(f.env, mailbox()),
			privateCacheKey(f.env, descriptor("pm:entity", 10, { id: 1 })),
			privateCacheKey(f.env, descriptor("pm:unread")),
		]);
		const result = await message.markAllRead(request(10, "messages/mark-all-read", "POST"), f.env);
		expect(result.status).toBe(200);
		expect(pmEpochWrites()).toEqual([pmUserGenKey(10)]);
		const current = await Promise.all([
			privateCacheKey(f.env, mailbox()),
			privateCacheKey(f.env, descriptor("pm:entity", 10, { id: 1 })),
			privateCacheKey(f.env, descriptor("pm:unread")),
		]);
		expect(current.every((key, index) => key !== keys[index])).toBe(true);
		expect(await getUnreadCount(f.env, undefined, 10)).toEqual({ count: 0 });
		expect(
			[...(await getMessages(f.env, undefined, 10, [1, 2])).values()].every(
				(row) => row.is_read === 1,
			),
		).toBe(true);
	});

	it("already-read mailboxes and repeated soft deletion perform no further epoch writes", async () => {
		expect(
			(await message.markAllRead(request(10, "messages/mark-all-read", "POST"), f.env)).status,
		).toBe(200);
		vi.mocked(f.env.KV.put).mockClear();
		expect(
			(await message.markAllRead(request(10, "messages/mark-all-read", "POST"), f.env)).status,
		).toBe(200);
		expect(pmEpochWrites()).toEqual([]);
		expect((await message.remove(request(10, "messages/1", "DELETE"), f.env)).status).toBe(200);
		vi.mocked(f.env.KV.put).mockClear();
		expect((await message.remove(request(10, "messages/1", "DELETE"), f.env)).status).toBe(200);
		expect(pmEpochWrites()).toEqual([]);
	});

	it("self caches preserve legacy hasAvatar and email, with current role/status rechecked", async () => {
		f.sqlite.exec(
			"UPDATE users SET has_avatar = 1, avatar_path = '', email = 'alice@example.com', email_normalized = 'alice@example.com', password_hash = 'private-hash', password_salt = 'private-salt', reg_ip = 'private-ip' WHERE id = 10",
		);
		const first = await readSelf(request(10, "auth/me"), f.env);
		expect(first.status).toBe(200);
		const data = (await first.json()).data;
		expect(data).toMatchObject({
			id: 10,
			email: "alice@example.com",
			emailNormalized: "alice@example.com",
			emailVerifiedAt: 1,
			hasAvatar: true,
			avatarPath: "",
		});
		expect(JSON.stringify(data)).not.toMatch(/private-hash|private-salt|private-ip/);
		f.calls.length = 0;
		f.sqlite.exec("UPDATE users SET role = 3 WHERE id = 10");
		expect((await (await readSelf(request(10, "auth/me"), f.env)).json()).data).toMatchObject({
			...data,
			role: 3,
		});
		expect(f.calls).toHaveLength(1);
		f.sqlite.exec("UPDATE users SET status = -1 WHERE id = 10");
		expect((await readSelf(request(10, "auth/me"), f.env)).status).toBe(403);
	});

	it.each(["profile", "email", "avatar"] as const)(
		"explicit %s changes evict only that user's self/checkin and all three preview action keys",
		async (kind) => {
			const privateEntries = (userId: number) => [
				descriptor("user:self", userId),
				descriptor("user:checkin", userId),
				...["thread", "reply", "message"].map((action) =>
					descriptor("user:posting-preview", userId, { action }),
				),
			];
			const own = privateEntries(10);
			const other = privateEntries(20);
			for (const d of [...own, ...other]) await getPrivateData(f.env, undefined, d);
			await getMessages(f.env, undefined, 10, [1]);
			const ownKeys = await Promise.all(own.map((d) => privateCacheKey(f.env, d)));
			const otherKeys = await Promise.all(other.map((d) => privateCacheKey(f.env, d)));
			const otherValues = otherKeys.map((key) => f.values.get(key));
			const pmKey = await privateCacheKey(f.env, descriptor("pm:entity", 10, { id: 1 }));
			vi.mocked(f.env.KV.delete).mockClear();
			if (kind === "profile") {
				expect(
					(await updateProfile(request(10, "users/me", "PATCH", { bio: "Updated bio" }), f.env))
						.status,
				).toBe(200);
			} else {
				f.sqlite.exec(
					kind === "email"
						? "UPDATE users SET email = 'new@example.com', email_verified_at = 2 WHERE id = 10"
						: "UPDATE users SET has_avatar = 1, avatar_path = 'new.jpg' WHERE id = 10",
				);
				await invalidateUserCaches(f.env, 10);
			}
			const deleted = vi.mocked(f.env.KV.delete).mock.calls.map(([key]) => key);
			for (const key of ownKeys) {
				expect(f.values.has(key)).toBe(false);
				expect(deleted.filter((value) => value === key)).toHaveLength(1);
			}
			expect(otherKeys.map((key) => f.values.get(key))).toEqual(otherValues);
			expect(f.values.has(pmKey)).toBe(true);
			expect(pmEpochWrites()).toEqual([]);
			const value = await getPrivateData<User>(f.env, undefined, descriptor("user:self"));
			expect(value).toMatchObject(
				kind === "profile"
					? { bio: "Updated bio" }
					: kind === "email"
						? { email: "new@example.com", emailVerifiedAt: 2 }
						: { hasAvatar: true, avatarPath: "new.jpg" },
			);
		},
	);

	it("checkin status keeps the current account gate and successful writes evict self/checkin/stats only for that user", async () => {
		await getPrivateData(f.env, undefined, descriptor("user:self"));
		await getPrivateData(f.env, undefined, descriptor("user:checkin"));
		await getPrivateData(f.env, undefined, descriptor("user:checkin", 20));
		f.calls.length = 0;
		const status = await checkin.status(request(10, "checkin/status"), f.env);
		expect((await status.json()).data).toMatchObject({
			checkedInToday: false,
			checkin: { totalDays: 10 },
		});
		expect(f.calls).toHaveLength(1);
		vi.mocked(f.env.KV.delete).mockClear();
		const response = await checkin.perform(
			request(10, "checkin", "POST", { mood: "kx", message: "Today" }),
			f.env,
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		const deleted = vi.mocked(f.env.KV.delete).mock.calls.map(([key]) => key);
		expect(deleted).toEqual(
			expect.arrayContaining(["user:self:10", "user:checkin:10", "user:stats:10"]),
		);
		expect(f.values.has("user:checkin:20")).toBe(true);
		expect(
			await getPrivateData<UserCheckin>(f.env, undefined, descriptor("user:checkin")),
		).toMatchObject({ totalDays: 11, message: "Today" });
		expect((await getPrivateData<User>(f.env, undefined, descriptor("user:self"))).coins).toBe(
			body.data.reward,
		);
		expect(
			f.sqlite.prepare("SELECT COUNT(*) AS n FROM checkin_history WHERE user_id = 10").get()?.n,
		).toBe(1);
		const duplicate = await checkin.perform(request(10, "checkin", "POST", { mood: "kx" }), f.env);
		expect(duplicate.status).toBe(409);
		f.sqlite.exec("UPDATE users SET status = -1 WHERE id = 10");
		expect((await checkin.status(request(10, "checkin/status"), f.env)).status).toBe(403);
	});

	it("a false-success checkin batch cannot report a reward or invalidate unchanged private data", async () => {
		await getPrivateData(f.env, undefined, descriptor("user:self"));
		await getPrivateData(f.env, undefined, descriptor("user:checkin"));
		const before = [f.values.get("user:self:10"), f.values.get("user:checkin:10")];
		vi.spyOn(f.env.DB, "batch").mockResolvedValue([
			{ success: false, error: "D1 write failed", results: [], meta: { changes: 0 } },
			{ success: false, error: "D1 batch rolled back", results: [], meta: { changes: 0 } },
			{ success: false, error: "D1 batch rolled back", results: [], meta: { changes: 0 } },
		] as unknown as D1Result[]);
		vi.mocked(f.env.KV.delete).mockClear();
		await expect(
			checkin.perform(request(10, "checkin", "POST", { mood: "kx" }), f.env),
		).rejects.toThrow();
		expect([f.values.get("user:self:10"), f.values.get("user:checkin:10")]).toEqual(before);
		expect(f.env.KV.delete).not.toHaveBeenCalled();
		expect(f.sqlite.prepare("SELECT coins FROM users WHERE id = 10").get()?.coins).toBe(0);
	});

	it.each([
		[
			"thread",
			thread.create,
			"threads",
			{ forumId: 1, subject: "New", content: "Body" },
			"features.content.allow_new_thread",
		],
		[
			"reply",
			post.create,
			"posts",
			{ threadId: 1, content: "Reply" },
			"features.content.allow_reply",
		],
		[
			"message",
			message.create,
			"messages",
			{ receiverId: 20, content: "PM" },
			"features.posting.require_avatar",
		],
	] as const)(
		"a cached allowed %s preview never authorizes a write after current restrictions change",
		async (action, handler, path, body, setting) => {
			const d = descriptor("user:posting-preview", 10, { action });
			expect(await getPrivateData<PostingPreview>(f.env, undefined, d)).toEqual({ allowed: true });
			f.insert("settings", { key: setting, value: action === "message" ? "true" : "false" });
			if (action === "message") {
				f.insert("settings", { key: "features.posting.enabled", value: "true" });
				f.sqlite.exec("UPDATE users SET avatar_path = '', has_avatar = 0 WHERE id = 10");
			}
			f.calls.length = 0;
			expect(await getPrivateData<PostingPreview>(f.env, undefined, d)).toEqual({ allowed: true });
			expect(f.calls).toHaveLength(0);
			const response = await handler(request(10, path, "POST", body), f.env);
			expect(response.status).toBe(403);
			expect((await response.json()).error.code).toBe(
				action === "message" ? "POSTING_RESTRICTION" : "CONTENT_DISABLED",
			);
			expect(
				f.calls.some((call) => call.sql.includes("SELECT status, avatar_path, has_avatar")),
			).toBe(true);
			expect(f.calls.some((call) => call.mode === "run")).toBe(false);
		},
	);
});
