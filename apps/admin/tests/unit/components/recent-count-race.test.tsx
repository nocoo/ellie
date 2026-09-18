// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

it("loads only the selected tab and ignores a late result after switching", async () => {
	let releaseUsers!: (value: ReturnType<typeof list>) => void;
	vi.mocked(fetchRecentUsers).mockImplementation(
		() =>
			new Promise((resolve) => {
				releaseUsers = resolve;
			}),
	);
	vi.mocked(fetchRecentThreads).mockResolvedValue(list(2));
	render(<RecentPage />);
	await waitFor(() => expect(fetchRecentUsers).toHaveBeenCalledTimes(1));
	expect(vi.mocked(fetchRecentUsers).mock.calls[0][3]).toBe(20);
	expect(fetchRecentThreads).not.toHaveBeenCalled();
	expect(fetchRecentPosts).not.toHaveBeenCalled();
	expect(fetchRecentAttachments).not.toHaveBeenCalled();
	fireEvent.mouseDown(screen.getByRole("tab", { name: /新主题/ }), { button: 0, ctrlKey: false });
	await waitFor(() => expect(fetchRecentThreads).toHaveBeenCalledTimes(1));
	await act(async () => releaseUsers(list(42)));
	expect(screen.getByRole("tab", { name: /新主题/ }).textContent).toContain("2");
	expect(screen.getByRole("tab", { name: /新用户/ }).textContent).not.toContain("42");
	expect(screen.getByRole("navigation", { name: "分页" }).textContent).toContain("共 2 条");
});
