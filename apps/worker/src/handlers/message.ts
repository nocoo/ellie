// Message (private messaging) handlers for Cloudflare Worker
// Ref: docs/12-private-messages.md §4

import { decodeGenericCursor } from "@ellie/types";
import { invalidateMessageUsers } from "../lib/cache/invalidate";
import {
	getMailbox,
	getMessages,
	getUnreadCount,
	loadMessageAccess,
	type MessageRow,
	mayReadMessage,
} from "../lib/cache/private-read";
import { applyCensorFilter } from "../lib/censor";
import { clampLimit } from "../lib/pagination";
import { parseIdFromPath } from "../lib/parseId";
import { checkPostingPermission } from "../lib/postingPermission";
import { jsonResponse } from "../lib/response";
import { withAuthVerified, withVerifiedEmail } from "../lib/routeHelpers";
import { errorResponse } from "../middleware/error";

// ─── Constants ───────────────────────────────────────────────
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const PREVIEW_LENGTH = 100;
const MAX_SUBJECT_LENGTH = 100;
const MAX_CONTENT_LENGTH = 10000;

// ─── Cursor helpers ──────────────────────────────────────────

interface MessageCursor {
	createdAt: number;
	id: number;
}

/** Validate message cursor payload shape */
function isMessageCursor(p: Partial<MessageCursor>): boolean {
	return (
		Number.isSafeInteger(p.createdAt) &&
		Number(p.createdAt) >= 0 &&
		Number.isSafeInteger(p.id) &&
		Number(p.id) > 0
	);
}

// ─── Mapper ──────────────────────────────────────────────────

function toMessageListItem(row: MessageRow) {
	const preview =
		row.content.length > PREVIEW_LENGTH
			? `${row.content.slice(0, PREVIEW_LENGTH)}...`
			: row.content;
	return {
		id: row.id,
		senderId: row.sender_id,
		senderName: row.sender_name,
		receiverId: row.receiver_id,
		receiverName: row.receiver_name,
		subject: row.subject,
		preview,
		isRead: row.is_read === 1,
		createdAt: row.created_at,
	};
}

function toMessageDetail(row: MessageRow) {
	return {
		id: row.id,
		senderId: row.sender_id,
		senderName: row.sender_name,
		receiverId: row.receiver_id,
		receiverName: row.receiver_name,
		subject: row.subject,
		content: row.content,
		isRead: row.is_read === 1,
		createdAt: row.created_at,
	};
}

// ─── Handlers ────────────────────────────────────────────────

/**
 * GET /api/v1/messages - List messages (inbox or outbox)
 *
 * Query params:
 * - box: "inbox" (default) or "outbox"
 * - limit: page size (default 20, max 100)
 * - cursor: pagination cursor
 */
export const list = withAuthVerified(async (request, env, user, ctx) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const query = new URL(request.url).searchParams;
	const box = query.get("box") === "outbox" ? "outbox" : "inbox";
	const limit =
		clampLimit(query.get("limit"), { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT }) ||
		DEFAULT_LIMIT;
	const token = query.get("cursor");
	const cursor = token ? decodeGenericCursor<MessageCursor>(token, isMessageCursor) : null;
	const [page, unread] = await Promise.all([
		getMailbox(env, ctx, {
			family: "pm:list",
			scope: `user:${user.userId}`,
			params: {
				userId: user.userId,
				box,
				limit,
				cursorTime: cursor?.createdAt ?? null,
				cursorId: cursor?.id ?? null,
			},
		}),
		box === "inbox" ? getUnreadCount(env, ctx, user.userId) : null,
	]);
	const access = await loadMessageAccess(
		env,
		page.items.map((item) => item.id),
	);
	const ids = page.items
		.map((item) => item.id)
		.filter((id) => {
			const gate = access.get(id);
			return (
				mayReadMessage(gate, user.userId) &&
				(box === "inbox" ? gate?.receiver_id : gate?.sender_id) === user.userId
			);
		});
	const rows = await getMessages(env, ctx, user.userId, ids);
	const messages = ids.flatMap((id) => {
		const row = rows.get(id);
		return row ? [toMessageListItem({ ...row, ...access.get(id) })] : [];
	});
	return jsonResponse(messages, origin, {
		nextCursor: page.nextCursor,
		...(unread ? { unreadCount: unread.count } : {}),
	});
});

export const unreadCount = withAuthVerified(async (request, env, user, ctx) => {
	return jsonResponse(
		await getUnreadCount(env, ctx, user.userId),
		request.headers.get("Origin") ?? undefined,
	);
});

/** A current ownership gate and read transition also run on a hot body snapshot. */
export const getById = withAuthVerified(async (request, env, user, ctx) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request);
	if (!id || id <= 0)
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid message ID" }, origin);
	let gate = (await loadMessageAccess(env, [id])).get(id);
	if (!mayReadMessage(gate, user.userId))
		return errorResponse("MESSAGE_NOT_FOUND", 404, undefined, origin);
	const row = (await getMessages(env, ctx, user.userId, [id])).get(id);
	if (!row || !gate) return errorResponse("MESSAGE_NOT_FOUND", 404, undefined, origin);
	if (gate.receiver_id === user.userId && gate.is_read === 0) {
		const written = await env.DB.prepare(
			"UPDATE messages SET is_read = 1 WHERE id = ? AND receiver_id = ? AND receiver_deleted = 0 AND is_read = 0",
		)
			.bind(id, user.userId)
			.run();
		if (!written.success) throw new Error("Message read state could not be saved");
		if (written.meta.changes > 0) {
			gate.is_read = 1;
			await invalidateMessageUsers(env, [gate.receiver_id]);
		} else {
			// A concurrent reader may have completed the transition, or ownership /
			// deletion may have changed since the first gate. Recheck before responding.
			gate = (await loadMessageAccess(env, [id])).get(id);
			if (!mayReadMessage(gate, user.userId))
				return errorResponse("MESSAGE_NOT_FOUND", 404, undefined, origin);
		}
	}
	return jsonResponse(toMessageDetail({ ...row, ...gate }), origin);
});

/**
 * POST /api/v1/messages - Send a new message
 */
export const create = withVerifiedEmail(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	// Check posting permission
	const permResult = await checkPostingPermission(env, user, origin);
	if (!permResult.allowed) {
		return permResult.error;
	}

	// Parse body
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	const receiverId = typeof body.receiverId === "number" ? body.receiverId : undefined;
	let subject = typeof body.subject === "string" ? body.subject.trim() : "";
	let content = typeof body.content === "string" ? body.content.trim() : "";

	// Validation
	if (typeof receiverId !== "number" || !Number.isSafeInteger(receiverId) || receiverId <= 0) {
		return errorResponse("INVALID_BODY", 400, { message: "receiverId is required" }, origin);
	}

	if (!content) {
		return errorResponse("INVALID_BODY", 400, { message: "content is required" }, origin);
	}

	if (subject.length > MAX_SUBJECT_LENGTH) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: `subject must be at most ${MAX_SUBJECT_LENGTH} characters` },
			origin,
		);
	}

	if (content.length > MAX_CONTENT_LENGTH) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: `content must be at most ${MAX_CONTENT_LENGTH} characters` },
			origin,
		);
	}

	// Cannot send to self
	if (receiverId === user.userId) {
		return errorResponse(
			"INVALID_REQUEST",
			400,
			{ message: "Cannot send message to yourself" },
			origin,
		);
	}

	// Receiver lookup, sender lookup, and (optional) subject + content censor
	// checks are all independent — fire them in parallel. Saves up to 3 D1
	// round-trips on the message-send hot path.
	const [receiver, sender, subjectCheck, contentCheck] = await Promise.all([
		env.DB.prepare("SELECT id, username, status FROM users WHERE id = ?")
			.bind(receiverId)
			.first<{ id: number; username: string; status: number }>(),
		env.DB.prepare("SELECT username FROM users WHERE id = ?")
			.bind(user.userId)
			.first<{ username: string }>(),
		subject ? applyCensorFilter(subject, env) : Promise.resolve(null),
		applyCensorFilter(content, env),
	]);

	if (!receiver || receiver.status < 0) {
		return errorResponse("USER_NOT_FOUND", 400, { message: "Receiver not found" }, origin);
	}

	const senderName = sender?.username ?? `user_${user.userId}`;

	if (subjectCheck) {
		if (subjectCheck.banned) {
			return errorResponse("CONTENT_BANNED", 403, undefined, origin);
		}
		subject = subjectCheck.content;
	}

	if (contentCheck.banned) {
		return errorResponse("CONTENT_BANNED", 403, undefined, origin);
	}
	content = contentCheck.content;

	const now = Math.floor(Date.now() / 1000);

	// Insert message
	const result = await env.DB.prepare(
		`INSERT INTO messages (sender_id, sender_name, receiver_id, receiver_name, subject, content, is_read, sender_deleted, receiver_deleted, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`,
	)
		.bind(user.userId, senderName, receiverId, receiver.username, subject, content, now)
		.run();

	if (!result.success) throw new Error("Message could not be saved");
	const messageId = result.meta.last_row_id;
	await invalidateMessageUsers(env, [user.userId, receiverId]);

	return jsonResponse(
		{
			id: messageId,
			receiverId: receiver.id,
			receiverName: receiver.username,
			subject,
			createdAt: now,
		},
		origin,
		undefined,
		201,
	);
});

/**
 * POST /api/v1/messages/mark-all-read - Mark all inbox messages as read
 */
export const markAllRead = withVerifiedEmail(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	const written = await env.DB.prepare(
		"UPDATE messages SET is_read = 1 WHERE receiver_id = ? AND is_read = 0 AND receiver_deleted = 0",
	)
		.bind(user.userId)
		.run();

	if (!written.success) throw new Error("Message read state could not be saved");
	if (written.meta.changes > 0) await invalidateMessageUsers(env, [user.userId]);
	return jsonResponse({ success: true }, origin);
});

/**
 * DELETE /api/v1/messages/:id - Delete a message (soft delete)
 */
export const remove = withVerifiedEmail(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request);

	if (id === null || id <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid message ID" }, origin);
	}

	const row = await env.DB.prepare(
		"SELECT sender_id, receiver_id, sender_deleted, receiver_deleted FROM messages WHERE id = ?",
	)
		.bind(id)
		.first<{
			sender_id: number;
			receiver_id: number;
			sender_deleted: number;
			receiver_deleted: number;
		}>();

	if (!row) {
		return errorResponse("MESSAGE_NOT_FOUND", 404, undefined, origin);
	}

	const isSender = row.sender_id === user.userId;
	const isReceiver = row.receiver_id === user.userId;

	if (!isSender && !isReceiver) {
		return errorResponse("MESSAGE_NOT_FOUND", 404, undefined, origin);
	}

	// Only a confirmed state transition publishes a new mailbox generation.
	let changed = false;
	if (isSender && row.sender_deleted === 0) {
		const saved = await env.DB.prepare(
			"UPDATE messages SET sender_deleted = 1 WHERE id = ? AND sender_id = ? AND sender_deleted = 0",
		)
			.bind(id, user.userId)
			.run();
		if (!saved.success) throw new Error("Message deletion was not confirmed");
		changed = saved.meta.changes > 0;
	} else if (isReceiver && row.receiver_deleted === 0) {
		const saved = await env.DB.prepare(
			"UPDATE messages SET receiver_deleted = 1 WHERE id = ? AND receiver_id = ? AND receiver_deleted = 0",
		)
			.bind(id, user.userId)
			.run();
		if (!saved.success) throw new Error("Message deletion was not confirmed");
		changed = saved.meta.changes > 0;
	}

	if (changed) await invalidateMessageUsers(env, [user.userId]);
	return jsonResponse({ deleted: true, id }, origin);
});
