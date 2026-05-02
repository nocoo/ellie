// Message (private messaging) handlers for Cloudflare Worker
// Ref: docs/12-private-messages.md §4

import { decodeGenericCursor, encodeGenericCursor } from "@ellie/types";
import { applyCensorFilter } from "../lib/censor";
import { clampLimit } from "../lib/pagination";
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
	return typeof p.createdAt === "number" && typeof p.id === "number";
}

// ─── D1 row type ─────────────────────────────────────────────

interface MessageRow {
	id: number;
	sender_id: number;
	sender_name: string;
	receiver_id: number;
	receiver_name: string;
	subject: string;
	content: string;
	is_read: number;
	sender_deleted: number;
	receiver_deleted: number;
	created_at: number;
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
export const list = withAuthVerified(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);

	const box = url.searchParams.get("box") === "outbox" ? "outbox" : "inbox";
	const clampedLimit = clampLimit(url.searchParams.get("limit"), {
		defaultLimit: DEFAULT_LIMIT,
		maxLimit: MAX_LIMIT,
	});

	const cursorStr = url.searchParams.get("cursor");
	const cursor = cursorStr ? decodeGenericCursor<MessageCursor>(cursorStr, isMessageCursor) : null;

	// Build query based on box type
	const isInbox = box === "inbox";
	const userIdColumn = isInbox ? "receiver_id" : "sender_id";
	const deletedColumn = isInbox ? "receiver_deleted" : "sender_deleted";

	let query: string;
	let bindings: (number | string)[];

	if (cursor) {
		query = `SELECT * FROM messages
		         WHERE ${userIdColumn} = ? AND ${deletedColumn} = 0
		         AND (created_at < ? OR (created_at = ? AND id < ?))
		         ORDER BY created_at DESC, id DESC
		         LIMIT ?`;
		bindings = [user.userId, cursor.createdAt, cursor.createdAt, cursor.id, clampedLimit];
	} else {
		query = `SELECT * FROM messages
		         WHERE ${userIdColumn} = ? AND ${deletedColumn} = 0
		         ORDER BY created_at DESC, id DESC
		         LIMIT ?`;
		bindings = [user.userId, clampedLimit];
	}

	const result = await env.DB.prepare(query)
		.bind(...bindings)
		.all<MessageRow>();
	const messages = result.results.map(toMessageListItem);

	// Generate next cursor
	let nextCursor: string | null = null;
	if (messages.length === clampedLimit && messages.length > 0) {
		const last = result.results[result.results.length - 1];
		nextCursor = encodeGenericCursor<MessageCursor>({ createdAt: last.created_at, id: last.id });
	}

	// Get unread count (inbox only)
	let unreadCount: number | undefined;
	if (isInbox) {
		const countResult = await env.DB.prepare(
			"SELECT COUNT(*) as count FROM messages WHERE receiver_id = ? AND is_read = 0 AND receiver_deleted = 0",
		)
			.bind(user.userId)
			.first<{ count: number }>();
		unreadCount = countResult?.count ?? 0;
	}

	return jsonResponse(messages, origin, {
		nextCursor,
		...(unreadCount !== undefined && { unreadCount }),
	});
});

/**
 * GET /api/v1/messages/unread-count - Get unread message count
 */
export const unreadCount = withAuthVerified(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	const result = await env.DB.prepare(
		"SELECT COUNT(*) as count FROM messages WHERE receiver_id = ? AND is_read = 0 AND receiver_deleted = 0",
	)
		.bind(user.userId)
		.first<{ count: number }>();

	return jsonResponse({ count: result?.count ?? 0 }, origin);
});

/**
 * GET /api/v1/messages/:id - Get message detail
 * Also marks the message as read if the viewer is the receiver.
 */
export const getById = withAuthVerified(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const pathParts = url.pathname.split("/");
	const idStr = pathParts[pathParts.length - 1];
	const id = Number.parseInt(idStr ?? "0", 10);

	if (Number.isNaN(id) || id <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid message ID" }, origin);
	}

	const row = await env.DB.prepare("SELECT * FROM messages WHERE id = ?")
		.bind(id)
		.first<MessageRow>();

	if (!row) {
		return errorResponse("MESSAGE_NOT_FOUND", 404, undefined, origin);
	}

	// Check access: must be sender or receiver, and not deleted
	const isSender = row.sender_id === user.userId;
	const isReceiver = row.receiver_id === user.userId;

	if (!isSender && !isReceiver) {
		return errorResponse("MESSAGE_NOT_FOUND", 404, undefined, origin);
	}

	// Check if deleted for this user
	if ((isSender && row.sender_deleted === 1) || (isReceiver && row.receiver_deleted === 1)) {
		return errorResponse("MESSAGE_NOT_FOUND", 404, undefined, origin);
	}

	// If receiver is viewing and message is unread, mark as read
	if (isReceiver && row.is_read === 0) {
		await env.DB.prepare("UPDATE messages SET is_read = 1 WHERE id = ?").bind(id).run();
		row.is_read = 1;
	}

	return jsonResponse(toMessageDetail(row), origin);
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
	if (typeof receiverId !== "number" || Number.isNaN(receiverId) || receiverId <= 0) {
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

	// Check receiver exists, is not banned/muted, and is not a placeholder
	// (status < 0 means banned, muted, or otherwise hidden — surface as
	// USER_NOT_FOUND consistent with the user-search endpoint and docs/12,
	// which only ever return users with status >= 0).
	const receiver = await env.DB.prepare("SELECT id, username, status FROM users WHERE id = ?")
		.bind(receiverId)
		.first<{ id: number; username: string; status: number }>();

	if (!receiver || receiver.status < 0) {
		return errorResponse("USER_NOT_FOUND", 400, { message: "Receiver not found" }, origin);
	}

	// Get sender info
	const sender = await env.DB.prepare("SELECT username FROM users WHERE id = ?")
		.bind(user.userId)
		.first<{ username: string }>();

	const senderName = sender?.username ?? `user_${user.userId}`;

	// Apply censor filter to subject and content
	if (subject) {
		const subjectCheck = await applyCensorFilter(subject, env);
		if (subjectCheck.banned) {
			return errorResponse("CONTENT_BANNED", 403, undefined, origin);
		}
		subject = subjectCheck.content;
	}

	const contentCheck = await applyCensorFilter(content, env);
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

	const messageId = result.meta.last_row_id;

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
 * DELETE /api/v1/messages/:id - Delete a message (soft delete)
 */
/**
 * POST /api/v1/messages/mark-all-read - Mark all inbox messages as read
 */
export const markAllRead = withVerifiedEmail(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	await env.DB.prepare(
		"UPDATE messages SET is_read = 1 WHERE receiver_id = ? AND is_read = 0 AND receiver_deleted = 0",
	)
		.bind(user.userId)
		.run();

	return jsonResponse({ success: true }, origin);
});

/**
 * DELETE /api/v1/messages/:id - Delete a message (soft delete)
 */
export const remove = withVerifiedEmail(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const pathParts = url.pathname.split("/");
	const idStr = pathParts[pathParts.length - 1];
	const id = Number.parseInt(idStr ?? "0", 10);

	if (Number.isNaN(id) || id <= 0) {
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

	// Soft delete based on user role
	if (isSender && row.sender_deleted === 0) {
		await env.DB.prepare("UPDATE messages SET sender_deleted = 1 WHERE id = ?").bind(id).run();
	} else if (isReceiver && row.receiver_deleted === 0) {
		await env.DB.prepare("UPDATE messages SET receiver_deleted = 1 WHERE id = ?").bind(id).run();
	}

	return jsonResponse({ deleted: true, id }, origin);
});
