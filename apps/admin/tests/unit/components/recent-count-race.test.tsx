// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import RecentPage from "@/app/(admin)/admin/recent/page";
import {
	fetchRecentAttachments,
	fetchRecentPosts,
	fetchRecentThreads,
	fetchRecentUsers,
} from "@/viewmodels/admin/recent";

vi.mock("@/viewmodels/admin/recent", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	fetchRecentAttachments: vi.fn(),
	fetchRecentPosts: vi.fn(),
	fetchRecentThreads: vi.fn(),
	fetchRecentUsers: vi.fn(),
}));
vi.mock("@/components/admin/admin-data-table", () => ({ AdminDataTable: () => null }));
vi.mock("@/components/admin/attachment-lightbox", () => ({ AttachmentLightbox: () => null }));
vi.mock("@/components/admin/admin-confirm-dialog", () => ({ AdminConfirmDialog: () => null }));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const list = (total: number) => ({ data: [], meta: { total, page: 1, pages: 3, limit: 20 } });

it.each([true, false])(
	"preserves the loaded total when background counts arrive late (failed: %s)",
	async (failed) => {
		let releaseAttachment!: (value: ReturnType<typeof list>) => void;
		vi.mocked(fetchRecentUsers).mockImplementation((_min, _max, _page, limit) => {
			if (limit !== 1) return Promise.resolve(list(42));
			return failed ? Promise.reject(new Error("count failed")) : Promise.resolve(list(41));
		});
		vi.mocked(fetchRecentPosts).mockResolvedValue(list(3));
		vi.mocked(fetchRecentThreads).mockResolvedValue(list(2));
		vi.mocked(fetchRecentAttachments).mockImplementation(
			() =>
				new Promise((resolve) => {
					releaseAttachment = resolve;
				}),
		);
		render(<RecentPage />);
		await waitFor(() =>
			expect(screen.getByRole("tab", { name: /新用户/ }).textContent).toContain("42"),
		);
		await act(async () => releaseAttachment(list(1)));
		expect(screen.getByRole("tab", { name: /新用户/ }).textContent).toContain("42");
		expect(screen.getByRole("navigation", { name: "分页" }).textContent).toContain("共 42 条");
	},
);
