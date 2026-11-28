import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/moderation-api", () => ({
	deleteMyPost: vi.fn(async () => {}),
	deletePost: vi.fn(async () => {}),
	editMyPost: vi.fn(async () => {}),
	editPost: vi.fn(async () => {}),
}));

import { deleteMyPost, deletePost, editMyPost, editPost } from "@/lib/moderation-api";
import {
	executePostDelete,
	executePostEdit,
	getDeleteStrategy,
} from "@/viewmodels/forum/use-post-actions";

describe("use-post-actions pure functions", () => {
	describe("getDeleteStrategy", () => {
		it('returns "self" for own post', () => {
			expect(getDeleteStrategy(true, false)).toBe("self");
			expect(getDeleteStrategy(true, true)).toBe("self"); // Own post takes priority
		});

		it('returns "moderate" for moderator deleting other\'s post', () => {
			expect(getDeleteStrategy(false, true)).toBe("moderate");
		});

		it('returns "none" when neither own post nor moderator', () => {
			expect(getDeleteStrategy(false, false)).toBe("none");
		});
	});
});

// ---------------------------------------------------------------------------
// executePostDelete
// ---------------------------------------------------------------------------

describe("executePostDelete", () => {
	it("calls deleteMyPost for self strategy", async () => {
		await executePostDelete(42, "self");
		expect(deleteMyPost).toHaveBeenCalledWith(42);
	});

	it("calls deletePost for moderate strategy", async () => {
		await executePostDelete(42, "moderate");
		expect(deletePost).toHaveBeenCalledWith(42);
	});
});

// ---------------------------------------------------------------------------
// executePostEdit
// ---------------------------------------------------------------------------

describe("executePostEdit", () => {
	it("calls editMyPost for own post", async () => {
		await executePostEdit(10, "new content", true, false);
		expect(editMyPost).toHaveBeenCalledWith(10, "new content");
	});

	it("calls editPost for moderator on non-own post", async () => {
		await executePostEdit(10, "new content", false, true);
		expect(editPost).toHaveBeenCalledWith(10, "new content");
	});

	it("prefers own post API even if moderator", async () => {
		await executePostEdit(10, "content", true, true);
		expect(editMyPost).toHaveBeenCalledWith(10, "content");
	});

	it("throws error when no permission", async () => {
		await expect(executePostEdit(10, "content", false, false)).rejects.toThrow("没有编辑权限");
	});
});
