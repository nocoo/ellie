// lib/error-messages.ts — Unified error message mapping (Model layer)
// Centralizes all API error code to user-friendly message translations.
// Part of MVVM Model layer - pure data, no React dependencies.

/**
 * Common API error codes used across the application.
 * Keep in sync with Worker error responses.
 */
export type ApiErrorCode =
	// Auth errors
	| "UNAUTHORIZED"
	| "NOT_AUTHENTICATED"
	| "AUTH_EXPIRED"
	// Content errors
	| "CONTENT_BANNED"
	| "CONTENT_TOO_SHORT"
	| "CONTENT_TOO_LONG"
	// Rate limiting
	| "RATE_LIMITED"
	// Forum/Thread errors
	| "FORUM_CLOSED"
	| "THREAD_CLOSED"
	| "THREAD_NOT_FOUND"
	| "POST_NOT_FOUND"
	// Permission errors
	| "FORBIDDEN"
	| "NO_PERMISSION"
	// Validation errors
	| "INVALID_BODY"
	| "VALIDATION_ERROR"
	// Generic
	| "UNKNOWN";

/**
 * Error messages for post/reply operations
 */
export const POST_ERROR_MESSAGES: Record<string, string> = {
	UNAUTHORIZED: "请先登录后再回复",
	NOT_AUTHENTICATED: "请先登录后再回复",
	THREAD_CLOSED: "该主题已关闭，无法回复",
	CONTENT_BANNED: "内容包含违禁词，请修改后重试",
	RATE_LIMITED: "操作过于频繁，请稍后再试",
	FORBIDDEN: "没有权限执行此操作",
	NO_PERMISSION: "没有权限执行此操作",
};

/**
 * Error messages for thread creation
 */
export const THREAD_ERROR_MESSAGES: Record<string, string> = {
	UNAUTHORIZED: "请先登录后再发帖",
	NOT_AUTHENTICATED: "请先登录后再发帖",
	FORUM_CLOSED: "该版块已关闭，无法发帖",
	CONTENT_BANNED: "内容包含违禁词，请修改后重试",
	RATE_LIMITED: "操作过于频繁，请稍后再试",
	FORBIDDEN: "没有权限在该版块发帖",
};

/**
 * Error messages for profile operations
 */
export const PROFILE_ERROR_MESSAGES: Record<string, string> = {
	NOT_AUTHENTICATED: "请先登录",
	UNAUTHORIZED: "请先登录",
	INVALID_BODY: "输入数据有误，请检查后重试",
	VALIDATION_ERROR: "输入数据有误，请检查后重试",
	RATE_LIMITED: "操作过于频繁，请稍后再试",
};

/**
 * Error messages for delete operations
 */
export const DELETE_ERROR_MESSAGES: Record<string, string> = {
	UNAUTHORIZED: "请先登录",
	NOT_AUTHENTICATED: "请先登录",
	FORBIDDEN: "没有删除权限",
	NO_PERMISSION: "没有删除权限",
	POST_NOT_FOUND: "帖子不存在或已被删除",
	THREAD_NOT_FOUND: "主题不存在或已被删除",
};

/**
 * Error messages for edit operations
 */
export const EDIT_ERROR_MESSAGES: Record<string, string> = {
	UNAUTHORIZED: "请先登录",
	NOT_AUTHENTICATED: "请先登录",
	FORBIDDEN: "没有编辑权限",
	NO_PERMISSION: "没有编辑权限",
	POST_NOT_FOUND: "帖子不存在或已被删除",
	CONTENT_BANNED: "内容包含违禁词，请修改后重试",
};

/**
 * Default fallback messages by operation type
 */
export const DEFAULT_ERROR_MESSAGES = {
	reply: "回复失败，请稍后重试",
	createThread: "发帖失败，请稍后重试",
	delete: "删除失败",
	edit: "编辑失败，请稍后重试",
	save: "保存失败，请稍后重试",
	generic: "操作失败，请稍后重试",
} as const;

/**
 * Get error message for a given error code and operation type.
 * Falls back to operation-specific default, then generic default.
 *
 * @param code - API error code
 * @param operation - Type of operation for context-appropriate message
 * @param messages - Optional custom message map to use first
 * @returns User-friendly error message in Chinese
 */
export function getErrorMessage(
	code: string | undefined,
	operation: keyof typeof DEFAULT_ERROR_MESSAGES = "generic",
	messages?: Record<string, string>,
): string {
	if (!code) {
		return DEFAULT_ERROR_MESSAGES[operation];
	}

	// Try custom messages first
	if (messages?.[code]) {
		return messages[code];
	}

	// Try operation-specific messages
	const operationMessages = getMessagesForOperation(operation);
	if (operationMessages?.[code]) {
		return operationMessages[code];
	}

	// Fall back to default for operation
	return DEFAULT_ERROR_MESSAGES[operation];
}

/**
 * Get the appropriate message map for an operation type
 */
function getMessagesForOperation(
	operation: keyof typeof DEFAULT_ERROR_MESSAGES,
): Record<string, string> | undefined {
	switch (operation) {
		case "reply":
			return POST_ERROR_MESSAGES;
		case "createThread":
			return THREAD_ERROR_MESSAGES;
		case "delete":
			return DELETE_ERROR_MESSAGES;
		case "edit":
			return EDIT_ERROR_MESSAGES;
		case "save":
			return PROFILE_ERROR_MESSAGES;
		default:
			return undefined;
	}
}

/**
 * Check if an error code indicates an authentication issue
 */
export function isAuthError(code: string | undefined): boolean {
	if (!code) return false;
	return ["UNAUTHORIZED", "NOT_AUTHENTICATED", "AUTH_EXPIRED"].includes(code);
}

/**
 * Check if an error code indicates a rate limit
 */
export function isRateLimitError(code: string | undefined): boolean {
	return code === "RATE_LIMITED";
}

/**
 * Check if an error code indicates content was blocked
 */
export function isContentBlockedError(code: string | undefined): boolean {
	return code === "CONTENT_BANNED";
}
