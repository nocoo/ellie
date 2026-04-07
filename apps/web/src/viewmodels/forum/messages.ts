/**
 * Messages page ViewModel — private messaging (站内信) data types and API hooks.
 *
 * Ref: docs/12-private-messages.md
 */

import { ApiError, apiClient } from "@/lib/api-client";
import type { BreadcrumbItem } from "@/viewmodels/shared/breadcrumbs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Message list item (from API) */
export interface MessageListItem {
	id: number;
	senderId: number;
	senderName: string;
	receiverId: number;
	receiverName: string;
	subject: string;
	preview: string;
	isRead: boolean;
	createdAt: number;
}

/** Full message detail (from API) */
export interface Message {
	id: number;
	senderId: number;
	senderName: string;
	receiverId: number;
	receiverName: string;
	subject: string;
	content: string;
	isRead: boolean;
	createdAt: number;
}

/** Send message payload */
export interface SendMessagePayload {
	receiverId: number;
	subject?: string;
	content: string;
}

/** Send message result */
export interface SendMessageResult {
	id: number;
	receiverId: number;
	receiverName: string;
	subject: string;
	createdAt: number;
}

/** User search result */
export interface UserSearchResult {
	id: number;
	username: string;
}

/** Sidebar menu item */
export interface SidebarItem {
	value: "inbox" | "outbox";
	label: string;
	icon: "mail" | "send";
}

/** Messages list response with pagination */
export interface MessagesListResponse {
	messages: MessageListItem[];
	nextCursor: string | null;
	unreadCount?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sidebar items for message boxes */
export const SIDEBAR_ITEMS: SidebarItem[] = [
	{ value: "inbox", label: "收信箱", icon: "mail" },
	{ value: "outbox", label: "发信箱", icon: "send" },
];

// ---------------------------------------------------------------------------
// API Functions (client-side)
// ---------------------------------------------------------------------------

/**
 * Fetch messages list (inbox or outbox).
 */
export async function fetchMessages(
	box: "inbox" | "outbox" = "inbox",
	cursor?: string,
	limit = 20,
): Promise<MessagesListResponse> {
	const params: Record<string, string | number | undefined> = { box, limit };
	if (cursor) params.cursor = cursor;

	const result = await apiClient.get<MessageListItem[]>("/api/v1/messages", params);

	// The meta may include nextCursor and unreadCount
	const meta = result.meta as { nextCursor?: string | null; unreadCount?: number };

	return {
		messages: result.data,
		nextCursor: meta.nextCursor ?? null,
		unreadCount: meta.unreadCount,
	};
}

/**
 * Fetch unread message count.
 */
export async function fetchUnreadCount(): Promise<number> {
	try {
		const result = await apiClient.get<{ count: number }>("/api/v1/messages/unread-count");
		return result.data.count;
	} catch {
		return 0;
	}
}

/**
 * Fetch single message detail.
 * Also marks the message as read if the viewer is the receiver.
 */
export async function fetchMessage(id: number): Promise<Message> {
	const result = await apiClient.get<Message>(`/api/v1/messages/${id}`);
	return result.data;
}

/**
 * Send a new message.
 */
export async function sendMessage(payload: SendMessagePayload): Promise<SendMessageResult> {
	const result = await apiClient.post<SendMessageResult>("/api/v1/messages", payload);
	return result.data;
}

/**
 * Delete a message (soft delete).
 */
export async function deleteMessage(id: number): Promise<void> {
	await apiClient.delete(`/api/v1/messages/${id}`);
}

/**
 * Mark all inbox messages as read.
 */
export async function markAllMessagesRead(): Promise<void> {
	await apiClient.post("/api/v1/messages/mark-all-read", {});
}

/**
 * Search users by username prefix (for autocomplete).
 */
export async function searchUsers(query: string, limit = 10): Promise<UserSearchResult[]> {
	if (!query || query.length < 2) return [];

	try {
		const result = await apiClient.get<UserSearchResult[]>("/api/v1/users/search", {
			q: query,
			limit,
		});
		return result.data;
	} catch (err) {
		// Silently return empty array on error
		if (err instanceof ApiError && err.status === 400) {
			return [];
		}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// React hooks (SWR-style patterns for use in client components)
// ---------------------------------------------------------------------------

export { ApiError };

// ---------------------------------------------------------------------------
// Breadcrumbs
// ---------------------------------------------------------------------------

export function buildMessagesBreadcrumbs(): BreadcrumbItem[] {
	return [{ label: "首页", href: "/" }, { label: "站内信" }];
}
