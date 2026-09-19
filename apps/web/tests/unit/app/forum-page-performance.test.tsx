import { Children, isValidElement, type ReactNode, Suspense } from "react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/forum-cache", () => ({
	getCachedForumThreadTypes: vi.fn(),
	getCachedPostsPerPage: vi.fn(async () => 20),
	getCachedRecommendedThreads: vi.fn(),
}));
vi.mock("@/lib/forum-self", () => ({ getSelfForumUser: vi.fn(async () => null) }));
vi.mock("@/viewmodels/forum/thread-list.server", () => ({ loadThreadListPaged: vi.fn() }));
vi.mock("@/viewmodels/forum/title.server", () => ({ getForumTitle: vi.fn() }));

import ForumThreadsPage from "@/app/(forum)/forums/[id]/page";
import { getCachedForumThreadTypes, getCachedRecommendedThreads } from "@/lib/forum-cache";
import { loadThreadListPaged } from "@/viewmodels/forum/thread-list.server";

const types = { enabled: true, required: false, listable: true, prefix: true, types: [] };
function page(typeId?: string) {
	return ForumThreadsPage({
		params: Promise.resolve({ id: "114" }),
		searchParams: Promise.resolve({ typeId }),
	});
}
function findSuspense(node: ReactNode): ReturnType<typeof Children.toArray> {
	return Children.toArray(node).flatMap((child) => {
		if (!isValidElement<{ children?: ReactNode }>(child)) return [];
		return child.type === Suspense ? [child] : findSuspense(child.props.children);
	});
}
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(getCachedForumThreadTypes).mockResolvedValue(types);
	vi.mocked(getCachedRecommendedThreads).mockResolvedValue({ threads: [] });
	vi.mocked(loadThreadListPaged).mockResolvedValue({
		forum: null,
		forums: [],
		items: [],
		page: 1,
		pages: 1,
		total: 0,
		limit: 20,
		breadcrumbs: [],
	});
});

it("starts the unfiltered list while type config is pending", async () => {
	let release!: (value: typeof types) => void;
	vi.mocked(getCachedForumThreadTypes).mockReturnValue(
		new Promise((resolve) => {
			release = resolve;
		}),
	);
	const result = page();
	for (let i = 0; i < 8; i++) await Promise.resolve();
	expect(loadThreadListPaged).toHaveBeenCalledOnce();
	release(types);
	await result;
	await expect(vi.mocked(loadThreadListPaged).mock.calls[0][0].includeTypeNameBadge).resolves.toBe(
		true,
	);
});

it("waits for the whitelist before sending a requested filter", async () => {
	let release!: (value: typeof types) => void;
	vi.mocked(getCachedForumThreadTypes).mockReturnValue(
		new Promise((resolve) => {
			release = resolve;
		}),
	);
	const result = page("999");
	for (let i = 0; i < 8; i++) await Promise.resolve();
	expect(loadThreadListPaged).not.toHaveBeenCalled();
	release(types);
	await result;
	expect(loadThreadListPaged).toHaveBeenCalledWith(expect.objectContaining({ typeId: null }));
});

it("returns the list with recommendations behind Suspense while their request is pending", async () => {
	let release!: (value: { threads: [] }) => void;
	vi.mocked(getCachedRecommendedThreads).mockReturnValue(
		new Promise((resolve) => {
			release = resolve;
		}),
	);
	const result = await page();
	const boundaries = findSuspense(result);
	expect(boundaries).toHaveLength(1);
	const boundary = boundaries[0];
	if (!isValidElement<{ fallback: ReactNode; children: ReactNode }>(boundary))
		throw new Error("Missing boundary");
	expect(boundary.props.fallback).toBeNull();
	release({ threads: [] });
});
