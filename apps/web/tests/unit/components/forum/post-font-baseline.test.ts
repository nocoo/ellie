// @vitest-environment happy-dom
// Tests for post-* font baseline — enforce the 14/12 mix per @zheng-li 口径:
//   - 14px (text-sm): titles, list titles, descriptions, primary entries
//   - 12px (text-xs): usernames, timestamps, view/reply/stat counts, meta rows
//   - Banned: text-2xs, text-[10px] (12px is the floor)
//
// Pins the load-bearing classes on mobile post header (author/time/floor),
// post content meta bar (digest badge + floor sup), and comment timestamps so
// a future drift back to text-2xs or text-sm becomes a visible regression.

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/link", () => ({
	default: ({ href, children, ...rest }: any) => createElement("a", { href, ...rest }, children),
}));

vi.mock("@/lib/cdn", () => ({
	getStaticImageUrl: (name: string) => `/static/${name}`,
	getAttachmentUrl: (path: string) => `/attachments/${path}`,
	getAttachmentThumbUrl: (path: string) => `/attachments/thumb/${path}`,
}));

vi.mock("@/lib/api-client", () => ({
	apiClient: { post: vi.fn(), get: vi.fn() },
}));

vi.mock("@/components/forum/user-avatar", () => ({
	ForumAvatar: () => createElement("div", { "data-testid": "avatar" }),
}));

vi.mock("@/components/forum/post-author-status-icon", () => ({
	PostAuthorStatusIcon: () => createElement("span", null),
}));

vi.mock("@/components/forum/post-action-bar", () => ({
	PostActionBar: () => createElement("div", null),
}));

vi.mock("@/components/forum/post-edit-dialog", () => ({
	PostEditDialog: () => null,
}));

vi.mock("@/components/forum/post-sidebar", () => ({
	PostSidebar: () => createElement("div", null),
}));

vi.mock("@/components/forum/post-comments", () => ({
	PostComments: () => createElement("div", null),
}));

vi.mock("@/components/forum/report-dialog", () => ({
	ReportDialog: () => null,
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
	ConfirmDialog: () => null,
}));

vi.mock("@/components/ui/avatar", () => ({
	Avatar: ({ children }: any) => createElement("div", null, children),
	AvatarFallback: ({ children }: any) => createElement("div", null, children),
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children, className, ...rest }: any) =>
		createElement("span", { className, ...rest }, children),
}));

vi.mock("@/viewmodels/forum/use-post-actions", () => ({
	usePostActions: () => ({
		state: { editDialogOpen: false, deleteDialogOpen: false, deleting: false, deleteError: null },
		actions: {
			handleEdit: vi.fn(),
			handleEditClose: vi.fn(),
			handleDeleteClick: vi.fn(),
			handleDeleteClose: vi.fn(),
			handleDeleteConfirm: vi.fn(),
		},
	}),
}));

vi.mock("@/viewmodels/forum/write-gate", () => ({
	writeGatePreflight: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/viewmodels/forum/thread-detail", () => ({
	floorLabel: (pos: number, isFirst: boolean) => (isFirst ? "楼主" : `${pos}`),
	formatDateTime: (t: number) => `t=${t}`,
	formatFileSize: (n: number) => `${n}B`,
}));

vi.mock("@/viewmodels/shared/formatting", () => ({
	formatRelativeTime: (t: number) => `rel=${t}`,
}));

afterEach(() => {
	cleanup();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePost(overrides: Record<string, unknown> = {}) {
	return {
		id: 42,
		threadId: 1,
		authorId: 7,
		position: 3,
		isFirst: false,
		createdAt: 1_710_000_000,
		content: "<p>hello</p>",
		comments: [],
		attachments: [],
		canEdit: false,
		canDelete: false,
		author: {
			id: 7,
			username: "alice",
			avatarPath: "",
			role: "user",
		},
		...overrides,
	};
}

// ─── post-card mobile header ──────────────────────────────────────────────────

import { PostCard } from "@/components/forum/post-card";

describe("PostCard mobile header — 14/12 baseline", () => {
	it("mobile author username uses text-xs (was text-sm — usernames are 12px)", () => {
		render(
			createElement(PostCard, {
				post: makePost() as any,
				canModerate: false,
				currentUserId: null,
				threadAuthorId: 7,
			}),
		);
		const author = screen.getByTestId("post-card-mobile-author");
		expect(author.className).toContain("text-xs");
		expect(author.className).not.toContain("text-sm");
	});

	it("mobile fallback '未知用户' also uses text-xs", () => {
		render(
			createElement(PostCard, {
				post: makePost({ author: null }) as any,
				canModerate: false,
				currentUserId: null,
				threadAuthorId: 7,
			}),
		);
		const author = screen.getByTestId("post-card-mobile-author");
		expect(author.className).toContain("text-xs");
		expect(author.textContent).toBe("未知用户");
	});

	it("mobile timestamp uses text-xs (was text-2xs — 12px floor)", () => {
		render(
			createElement(PostCard, {
				post: makePost() as any,
				canModerate: false,
				currentUserId: null,
				threadAuthorId: 7,
			}),
		);
		const time = screen.getByTestId("post-card-mobile-time");
		expect(time.className).toContain("text-xs");
		expect(time.className).not.toContain("text-2xs");
	});

	it("mobile floor sup uses text-xs (was text-2xs)", () => {
		render(
			createElement(PostCard, {
				post: makePost() as any,
				canModerate: false,
				currentUserId: null,
				threadAuthorId: 7,
			}),
		);
		const floor = screen.getByTestId("post-card-mobile-floor");
		const sup = floor.querySelector("sup");
		expect(sup?.className).toContain("text-xs");
		expect(sup?.className).not.toContain("text-2xs");
	});
});

// ─── post-content meta bar ────────────────────────────────────────────────────

import { PostContent } from "@/components/forum/post-content";

describe("PostContent meta bar — 14/12 baseline", () => {
	it("digest badge uses text-xs (was text-sm — badge is meta-tier)", () => {
		render(
			createElement(PostContent, {
				post: makePost({ isFirst: true }) as any,
				isFirst: true,
				threadDigest: 1,
				threadAuthorId: 7,
				author: makePost().author as any,
			}),
		);
		const badge = screen.getByTestId("post-content-digest-badge");
		expect(badge.className).toContain("text-xs");
		expect(badge.className).not.toContain("text-sm");
		// Padding kept (variant unchanged per reviewer's "只改字体" instruction).
		expect(badge.className).toContain("px-2");
		expect(badge.className).toContain("py-0.5");
	});

	it("floor sup uses text-xs (was text-2xs)", () => {
		render(
			createElement(PostContent, {
				post: makePost() as any,
				isFirst: false,
				threadAuthorId: 7,
				author: makePost().author as any,
			}),
		);
		const floor = screen.getByTestId("post-content-floor");
		const sup = floor.querySelector("sup");
		expect(sup?.className).toContain("text-xs");
		expect(sup?.className).not.toContain("text-2xs");
	});
});

// Note: comment timestamp's `text-xs` baseline assertion lives in
// post-comments-initial.test.ts (alongside the existing PostComments tests
// that already have the right mock setup for that component).
//
// Note: PostSidebar's 14/12 assertions live in post-sidebar-font.test.ts —
// this file's hoisted PostSidebar mock prevents asserting against its real DOM.
