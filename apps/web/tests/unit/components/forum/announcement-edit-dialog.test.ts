// @vitest-environment happy-dom
// Component test for AnnouncementEditDialog — pins the reviewer's
// boundaries from msg e5bba9a6:
//   #2 preview ≠ submit transformer: raw textarea content goes to the
//      Worker untouched (no client-side sanitization on submit)
//   #3 byte counter is UX-only; Save button is NOT disabled past 4 KiB
//      because the Worker computes the limit POST-sanitize
//   + general dialog behavior (initial value, error banner, refresh on
//      success)

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────

const setAnnouncementMock = vi.fn();
vi.mock("@/lib/forum-announcement-api", () => ({
	setForumAnnouncement: (...args: unknown[]) => setAnnouncementMock(...args),
}));

const routerRefreshMock = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: routerRefreshMock, push: vi.fn() }),
}));

// SafeRichHtml renders sanitized HTML — for the preview we just want to
// see that the textarea value gets passed through. Stub it to a marker.
vi.mock("@/components/forum/safe-rich-html", () => ({
	SafeRichHtml: ({ html }: { html: string }) =>
		createElement("div", { "data-testid": "preview" }, html),
}));

vi.mock("@/components/forum/dialog-hero-header", () => ({
	DialogHeroHeader: ({ title }: { title: string }) => createElement("h2", null, title),
}));
vi.mock("@/components/forum/dialog-error-banner", () => ({
	DialogErrorBanner: ({ message }: { message: string }) =>
		createElement("div", { role: "alert" }, message),
}));

import { AnnouncementEditDialog } from "@/components/forum/announcement-edit-dialog";
import { ApiError } from "@/lib/api-error";

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
});

function renderDialog(initial = "", onOpenChange = vi.fn()) {
	return {
		onOpenChange,
		...render(
			createElement(AnnouncementEditDialog, {
				open: true,
				onOpenChange,
				forumId: 7,
				forumName: "测试版块",
				initialAnnouncement: initial,
			}),
		),
	};
}

describe("AnnouncementEditDialog — initial state", () => {
	it("seeds the textarea with the initial announcement", () => {
		renderDialog("<p>原文</p>");
		const textarea = screen.getByLabelText("内容") as HTMLTextAreaElement;
		expect(textarea.value).toBe("<p>原文</p>");
	});

	it("renders the dialog title", () => {
		renderDialog();
		expect(screen.getByText("编辑版块公告")).toBeTruthy();
	});
});

describe("AnnouncementEditDialog — byte counter is advisory only", () => {
	it("counts UTF-8 bytes, not characters (Chinese is 3 bytes/char)", () => {
		renderDialog("你好");
		// 你好 is 2 chars × 3 bytes = 6 bytes
		expect(screen.getByText(/约\s*6\s*\/\s*4096\s*字节/)).toBeTruthy();
	});

	it("keeps the Save button enabled when over 4 KiB", () => {
		// 5000 bytes of ASCII = 5000 chars
		const big = "a".repeat(5000);
		renderDialog(big);
		expect(screen.getByText(/约\s*5000\s*\/\s*4096\s*字节/)).toBeTruthy();
		const save = screen.getByRole("button", { name: /保存/ }) as HTMLButtonElement;
		expect(save.disabled).toBe(false);
	});
});

describe("AnnouncementEditDialog — save flow", () => {
	it("sends the RAW textarea content to the Worker (no client-side sanitization)", async () => {
		// Reviewer guidance #2: the preview sanitizer is NOT the submit
		// transformer. The Worker is authoritative — we must POST the
		// moderator's raw input verbatim, including the malicious-looking
		// <script> below. The Worker will strip it and return the cleaned
		// HTML.
		const raw = '<p>ok</p><script>alert("xss")</script>';
		setAnnouncementMock.mockResolvedValue({ id: 7, announcement: "<p>ok</p>" });

		const { onOpenChange } = renderDialog(raw);
		fireEvent.click(screen.getByRole("button", { name: /保存/ }));

		await waitFor(() => {
			expect(setAnnouncementMock).toHaveBeenCalledWith(7, raw);
		});
		await waitFor(() => {
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});
		expect(routerRefreshMock).toHaveBeenCalled();
	});

	it("shows the Chinese error message for PAYLOAD_TOO_LARGE", async () => {
		setAnnouncementMock.mockRejectedValue(new ApiError(413, "PAYLOAD_TOO_LARGE", "too big"));
		renderDialog("<p>x</p>");
		fireEvent.click(screen.getByRole("button", { name: /保存/ }));
		await waitFor(() => {
			expect(screen.getByRole("alert").textContent).toMatch(/4 KiB/);
		});
		expect(routerRefreshMock).not.toHaveBeenCalled();
	});

	it("shows the Chinese error message for FORBIDDEN", async () => {
		setAnnouncementMock.mockRejectedValue(new ApiError(403, "FORBIDDEN", "nope"));
		renderDialog("<p>x</p>");
		fireEvent.click(screen.getByRole("button", { name: /保存/ }));
		await waitFor(() => {
			expect(screen.getByRole("alert").textContent).toMatch(/权限/);
		});
	});

	it("shows a generic fallback for unknown ApiError codes", async () => {
		setAnnouncementMock.mockRejectedValue(new ApiError(500, "UNKNOWN_X", "boom"));
		renderDialog("<p>x</p>");
		fireEvent.click(screen.getByRole("button", { name: /保存/ }));
		await waitFor(() => {
			// Falls back to err.message ("boom") rather than the generic copy.
			expect(screen.getByRole("alert").textContent).toMatch(/boom|保存失败/);
		});
	});
});

describe("AnnouncementEditDialog — preview surface", () => {
	it("renders the textarea content through the SafeRichHtml preview", () => {
		renderDialog("<p>hello</p>");
		const preview = screen.getByTestId("preview");
		expect(preview.textContent).toBe("<p>hello</p>");
	});

	it("shows an empty-state hint when the textarea is whitespace-only", () => {
		renderDialog("   \n\t  ");
		expect(screen.getByText("（无内容）")).toBeTruthy();
		expect(screen.queryByTestId("preview")).toBeNull();
	});
});
