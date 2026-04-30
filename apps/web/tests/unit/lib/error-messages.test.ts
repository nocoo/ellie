import {
	DEFAULT_ERROR_MESSAGES,
	DELETE_ERROR_MESSAGES,
	EDIT_ERROR_MESSAGES,
	POST_ERROR_MESSAGES,
	PROFILE_ERROR_MESSAGES,
	THREAD_ERROR_MESSAGES,
	getErrorMessage,
	isAuthError,
	isContentBlockedError,
	isRateLimitError,
} from "@/lib/error-messages";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// getErrorMessage
// ---------------------------------------------------------------------------

describe("getErrorMessage", () => {
	describe("reply operation", () => {
		it("returns specific message for UNAUTHORIZED", () => {
			expect(getErrorMessage("UNAUTHORIZED", "reply")).toBe("请先登录后再回复");
		});

		it("returns specific message for THREAD_CLOSED", () => {
			expect(getErrorMessage("THREAD_CLOSED", "reply")).toBe("该主题已关闭，无法回复");
		});

		it("returns specific message for CONTENT_BANNED", () => {
			expect(getErrorMessage("CONTENT_BANNED", "reply")).toBe("内容包含违禁词，请修改后重试");
		});

		it("returns specific message for RATE_LIMITED", () => {
			expect(getErrorMessage("RATE_LIMITED", "reply")).toBe("操作过于频繁，请稍后再试");
		});

		it("returns default message for unknown code", () => {
			expect(getErrorMessage("UNKNOWN_CODE", "reply")).toBe("回复失败，请稍后重试");
		});

		it("returns default message for undefined code", () => {
			expect(getErrorMessage(undefined, "reply")).toBe("回复失败，请稍后重试");
		});
	});

	describe("createThread operation", () => {
		it("returns specific message for UNAUTHORIZED", () => {
			expect(getErrorMessage("UNAUTHORIZED", "createThread")).toBe("请先登录后再发帖");
		});

		it("returns specific message for FORUM_CLOSED", () => {
			expect(getErrorMessage("FORUM_CLOSED", "createThread")).toBe("该版块已关闭，无法发帖");
		});

		it("returns default message for unknown code", () => {
			expect(getErrorMessage("UNKNOWN_CODE", "createThread")).toBe("发帖失败，请稍后重试");
		});
	});

	describe("delete operation", () => {
		it("returns specific message for FORBIDDEN", () => {
			expect(getErrorMessage("FORBIDDEN", "delete")).toBe("没有删除权限");
		});

		it("returns specific message for POST_NOT_FOUND", () => {
			expect(getErrorMessage("POST_NOT_FOUND", "delete")).toBe("回复不存在或已被删除");
		});

		it("returns default message for unknown code", () => {
			expect(getErrorMessage("UNKNOWN_CODE", "delete")).toBe("删除失败");
		});
	});

	describe("edit operation", () => {
		it("returns specific message for FORBIDDEN", () => {
			expect(getErrorMessage("FORBIDDEN", "edit")).toBe("没有编辑权限");
		});

		it("returns specific message for CONTENT_BANNED", () => {
			expect(getErrorMessage("CONTENT_BANNED", "edit")).toBe("内容包含违禁词，请修改后重试");
		});

		it("returns default message for unknown code", () => {
			expect(getErrorMessage("UNKNOWN_CODE", "edit")).toBe("编辑失败，请稍后重试");
		});
	});

	describe("save operation", () => {
		it("returns specific message for INVALID_BODY", () => {
			expect(getErrorMessage("INVALID_BODY", "save")).toBe("输入数据有误，请检查后重试");
		});

		it("returns default message for unknown code", () => {
			expect(getErrorMessage("UNKNOWN_CODE", "save")).toBe("保存失败，请稍后重试");
		});
	});

	describe("generic operation", () => {
		it("returns generic default for unknown code", () => {
			expect(getErrorMessage("UNKNOWN_CODE", "generic")).toBe("操作失败，请稍后重试");
		});

		it("returns generic default when no operation specified", () => {
			expect(getErrorMessage("UNKNOWN_CODE")).toBe("操作失败，请稍后重试");
		});
	});

	describe("custom messages override", () => {
		it("uses custom message when provided", () => {
			const customMessages = { CUSTOM_ERROR: "自定义错误消息" };
			expect(getErrorMessage("CUSTOM_ERROR", "reply", customMessages)).toBe("自定义错误消息");
		});

		it("falls back to operation messages when custom not found", () => {
			const customMessages = { OTHER_ERROR: "其他错误" };
			expect(getErrorMessage("UNAUTHORIZED", "reply", customMessages)).toBe("请先登录后再回复");
		});
	});
});

// ---------------------------------------------------------------------------
// isAuthError
// ---------------------------------------------------------------------------

describe("isAuthError", () => {
	it("returns true for UNAUTHORIZED", () => {
		expect(isAuthError("UNAUTHORIZED")).toBe(true);
	});

	it("returns true for NOT_AUTHENTICATED", () => {
		expect(isAuthError("NOT_AUTHENTICATED")).toBe(true);
	});

	it("returns true for AUTH_EXPIRED", () => {
		expect(isAuthError("AUTH_EXPIRED")).toBe(true);
	});

	it("returns false for other codes", () => {
		expect(isAuthError("RATE_LIMITED")).toBe(false);
		expect(isAuthError("FORBIDDEN")).toBe(false);
		expect(isAuthError("CONTENT_BANNED")).toBe(false);
	});

	it("returns false for undefined", () => {
		expect(isAuthError(undefined)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// isRateLimitError
// ---------------------------------------------------------------------------

describe("isRateLimitError", () => {
	it("returns true for RATE_LIMITED", () => {
		expect(isRateLimitError("RATE_LIMITED")).toBe(true);
	});

	it("returns false for other codes", () => {
		expect(isRateLimitError("UNAUTHORIZED")).toBe(false);
		expect(isRateLimitError("FORBIDDEN")).toBe(false);
	});

	it("returns false for undefined", () => {
		expect(isRateLimitError(undefined)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// isContentBlockedError
// ---------------------------------------------------------------------------

describe("isContentBlockedError", () => {
	it("returns true for CONTENT_BANNED", () => {
		expect(isContentBlockedError("CONTENT_BANNED")).toBe(true);
	});

	it("returns false for other codes", () => {
		expect(isContentBlockedError("UNAUTHORIZED")).toBe(false);
		expect(isContentBlockedError("RATE_LIMITED")).toBe(false);
	});

	it("returns false for undefined", () => {
		expect(isContentBlockedError(undefined)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Message maps completeness
// ---------------------------------------------------------------------------

describe("message maps completeness", () => {
	it("POST_ERROR_MESSAGES has required keys", () => {
		expect(POST_ERROR_MESSAGES.UNAUTHORIZED).toBeDefined();
		expect(POST_ERROR_MESSAGES.THREAD_CLOSED).toBeDefined();
		expect(POST_ERROR_MESSAGES.CONTENT_BANNED).toBeDefined();
		expect(POST_ERROR_MESSAGES.RATE_LIMITED).toBeDefined();
	});

	it("THREAD_ERROR_MESSAGES has required keys", () => {
		expect(THREAD_ERROR_MESSAGES.UNAUTHORIZED).toBeDefined();
		expect(THREAD_ERROR_MESSAGES.FORUM_CLOSED).toBeDefined();
		expect(THREAD_ERROR_MESSAGES.CONTENT_BANNED).toBeDefined();
		expect(THREAD_ERROR_MESSAGES.RATE_LIMITED).toBeDefined();
	});

	it("DELETE_ERROR_MESSAGES has required keys", () => {
		expect(DELETE_ERROR_MESSAGES.FORBIDDEN).toBeDefined();
		expect(DELETE_ERROR_MESSAGES.POST_NOT_FOUND).toBeDefined();
		expect(DELETE_ERROR_MESSAGES.THREAD_NOT_FOUND).toBeDefined();
	});

	it("EDIT_ERROR_MESSAGES has required keys", () => {
		expect(EDIT_ERROR_MESSAGES.FORBIDDEN).toBeDefined();
		expect(EDIT_ERROR_MESSAGES.POST_NOT_FOUND).toBeDefined();
		expect(EDIT_ERROR_MESSAGES.CONTENT_BANNED).toBeDefined();
	});

	it("PROFILE_ERROR_MESSAGES has required keys", () => {
		expect(PROFILE_ERROR_MESSAGES.NOT_AUTHENTICATED).toBeDefined();
		expect(PROFILE_ERROR_MESSAGES.INVALID_BODY).toBeDefined();
	});

	it("DEFAULT_ERROR_MESSAGES has all operation types", () => {
		expect(DEFAULT_ERROR_MESSAGES.reply).toBeDefined();
		expect(DEFAULT_ERROR_MESSAGES.createThread).toBeDefined();
		expect(DEFAULT_ERROR_MESSAGES.delete).toBeDefined();
		expect(DEFAULT_ERROR_MESSAGES.edit).toBeDefined();
		expect(DEFAULT_ERROR_MESSAGES.save).toBeDefined();
		expect(DEFAULT_ERROR_MESSAGES.generic).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Message consistency
// ---------------------------------------------------------------------------

describe("message consistency", () => {
	it("all auth errors map to login prompt", () => {
		// Both UNAUTHORIZED and NOT_AUTHENTICATED should prompt login
		expect(POST_ERROR_MESSAGES.UNAUTHORIZED).toContain("登录");
		expect(POST_ERROR_MESSAGES.NOT_AUTHENTICATED).toContain("登录");
	});

	it("all rate limit errors use consistent message", () => {
		expect(POST_ERROR_MESSAGES.RATE_LIMITED).toBe("操作过于频繁，请稍后再试");
		expect(THREAD_ERROR_MESSAGES.RATE_LIMITED).toBe("操作过于频繁，请稍后再试");
		expect(PROFILE_ERROR_MESSAGES.RATE_LIMITED).toBe("操作过于频繁，请稍后再试");
	});

	it("all content banned errors use consistent message", () => {
		expect(POST_ERROR_MESSAGES.CONTENT_BANNED).toBe("内容包含违禁词，请修改后重试");
		expect(THREAD_ERROR_MESSAGES.CONTENT_BANNED).toBe("内容包含违禁词，请修改后重试");
		expect(EDIT_ERROR_MESSAGES.CONTENT_BANNED).toBe("内容包含违禁词，请修改后重试");
	});
});
