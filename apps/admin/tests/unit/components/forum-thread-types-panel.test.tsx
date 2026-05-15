// ForumThreadTypesPanel DOM tests — #8 slice 2.
//
// Reviewer (msg 9581035d) explicitly required component-level coverage,
// not just the pure helpers. We pin the behavioural contracts that
// matter at the API-call boundary:
//
//   1. Expanding the panel triggers `fetchForumThreadTypes` exactly once
//      (lazy fetch). Collapsing + reopening within the same dialog
//      session does NOT refetch.
//   2. Saving the 4-switch config sends ONLY the diffed fields, not the
//      whole config.
//   3. `required=true` with `enabled=false` is rejected client-side; no
//      `updateForumThreadTypesConfig` request goes out.
//   4. Row create/update/delete/reorder each dispatch to the matching
//      viewmodel function with the right arguments.
//   5. Delete soft-disable surfaces a "停用 / 仍被 N 个主题引用" message
//      and keeps the row visible with `enabled=false`.
//
// The viewmodel module is mocked at the boundary so we never hit the
// real `apiClient` from this file.

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/viewmodels/admin/forum-thread-types", async () => {
	const actual = await vi.importActual<typeof import("@/viewmodels/admin/forum-thread-types")>(
		"@/viewmodels/admin/forum-thread-types",
	);
	return {
		...actual,
		fetchForumThreadTypes: vi.fn(),
		createForumThreadType: vi.fn(),
		updateForumThreadType: vi.fn(),
		deleteForumThreadType: vi.fn(),
		reorderForumThreadTypes: vi.fn(),
		updateForumThreadTypesConfig: vi.fn(),
	};
});

import { ForumThreadTypesPanel } from "@/components/admin/forum-thread-types-panel";
import {
	type ForumThreadType,
	type ForumThreadTypeListResponse,
	createForumThreadType,
	deleteForumThreadType,
	fetchForumThreadTypes,
	reorderForumThreadTypes,
	updateForumThreadType,
	updateForumThreadTypesConfig,
} from "@/viewmodels/admin/forum-thread-types";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockFetch = fetchForumThreadTypes as unknown as ReturnType<typeof vi.fn>;
const mockCreate = createForumThreadType as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = updateForumThreadType as unknown as ReturnType<typeof vi.fn>;
const mockDelete = deleteForumThreadType as unknown as ReturnType<typeof vi.fn>;
const mockReorder = reorderForumThreadTypes as unknown as ReturnType<typeof vi.fn>;
const mockUpdateConfig = updateForumThreadTypesConfig as unknown as ReturnType<typeof vi.fn>;

const FORUM_ID = 42;

function makeRow(overrides: Partial<ForumThreadType> = {}): ForumThreadType {
	return {
		id: 1,
		forumId: FORUM_ID,
		sourceTypeid: 10,
		name: "公告",
		displayOrder: 0,
		icon: "",
		enabled: true,
		moderatorOnly: false,
		...overrides,
	};
}

function makePayload(
	overrides: Partial<ForumThreadTypeListResponse> = {},
): ForumThreadTypeListResponse {
	return {
		forumId: FORUM_ID,
		config: { enabled: false, required: false, listable: false, prefix: false },
		types: [makeRow({ id: 1, name: "公告", displayOrder: 0, sourceTypeid: 10 })],
		...overrides,
	};
}

/** Click the collapsible header to open the panel and wait for the
 *  list to finish loading. */
async function expandAndWait(getRowName: string | RegExp = "公告") {
	const toggle = screen.getByRole("button", { name: /主题分类/ });
	await act(async () => {
		fireEvent.click(toggle);
	});
	await waitFor(() => {
		expect(screen.queryByText(getRowName)).not.toBeNull();
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	// happy-dom doesn't implement window.confirm — default it to true so
	// the delete path can run through end-to-end. Individual tests
	// override as needed.
	vi.stubGlobal(
		"confirm",
		vi.fn(() => true),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("ForumThreadTypesPanel — null forumId", () => {
	it("renders the disabled placeholder and never fetches", () => {
		render(<ForumThreadTypesPanel forumId={null} />);
		expect(screen.queryByText(/版块创建后才能配置/)).not.toBeNull();
		expect(mockFetch).not.toHaveBeenCalled();
	});
});

describe("ForumThreadTypesPanel — lazy fetch", () => {
	it("does NOT fetch before the panel is expanded", () => {
		mockFetch.mockResolvedValue(makePayload());
		render(<ForumThreadTypesPanel forumId={FORUM_ID} />);
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("fetches exactly once on first expand and reuses the payload on re-expand", async () => {
		mockFetch.mockResolvedValue(makePayload());
		render(<ForumThreadTypesPanel forumId={FORUM_ID} />);

		await expandAndWait();
		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(mockFetch).toHaveBeenCalledWith(FORUM_ID);

		// Collapse, then re-expand. The cached "ready" state should keep
		// the list visible without triggering another fetch.
		const toggle = screen.getByRole("button", { name: /主题分类/ });
		await act(async () => {
			fireEvent.click(toggle);
		});
		await act(async () => {
			fireEvent.click(toggle);
		});
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});
});

describe("ForumThreadTypesPanel — config save (diff)", () => {
	it("sends ONLY the flipped flag, not the whole config", async () => {
		mockFetch.mockResolvedValue(makePayload());
		mockUpdateConfig.mockResolvedValue({
			forumId: FORUM_ID,
			config: { enabled: true, required: false, listable: false, prefix: false },
		});
		render(<ForumThreadTypesPanel forumId={FORUM_ID} />);
		await expandAndWait();

		// Flip "启用主题分类" on (was false on load).
		const enabledCheckbox = screen.getByLabelText("启用主题分类") as HTMLInputElement;
		await act(async () => {
			fireEvent.click(enabledCheckbox);
		});

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /^保存配置$/ }));
		});

		await waitFor(() => {
			expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
		});
		// Only `enabled` should be in the patch — the other three flags
		// were unchanged.
		expect(mockUpdateConfig).toHaveBeenCalledWith(FORUM_ID, { enabled: true });
	});

	it("rejects required=true with enabled=false client-side (no API call)", async () => {
		mockFetch.mockResolvedValue(makePayload());
		render(<ForumThreadTypesPanel forumId={FORUM_ID} />);
		await expandAndWait();

		// Flip required on while enabled stays off.
		const requiredCheckbox = screen.getByLabelText("发帖必选") as HTMLInputElement;
		await act(async () => {
			fireEvent.click(requiredCheckbox);
		});

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /^保存配置$/ }));
		});

		// Invariant message visible and no request fired.
		await waitFor(() => {
			expect(screen.queryByText(/必须先启用主题分类/)).not.toBeNull();
		});
		expect(mockUpdateConfig).not.toHaveBeenCalled();
	});
});

describe("ForumThreadTypesPanel — row CRUD", () => {
	it("create: submits to createForumThreadType with trimmed body", async () => {
		mockFetch.mockResolvedValue(makePayload({ types: [] }));
		mockCreate.mockResolvedValue(
			makeRow({ id: 9, name: "新分类", displayOrder: 0, sourceTypeid: 9 }),
		);
		render(<ForumThreadTypesPanel forumId={FORUM_ID} />);
		await expandAndWait(/暂无主题分类/);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /新建分类/ }));
		});

		const nameInput = (await waitFor(() => {
			const el = document.querySelector("input[placeholder='分类名']");
			expect(el).not.toBeNull();
			return el as HTMLInputElement;
		})) as HTMLInputElement;
		await act(async () => {
			fireEvent.change(nameInput, { target: { value: "  新分类  " } });
		});

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /^创建$/ }));
		});

		await waitFor(() => {
			expect(mockCreate).toHaveBeenCalledTimes(1);
		});
		expect(mockCreate).toHaveBeenCalledWith(FORUM_ID, {
			name: "新分类",
			displayOrder: 0,
			icon: "",
			moderatorOnly: false,
		});
	});

	it("update: PATCH carries only changed fields", async () => {
		mockFetch.mockResolvedValue(
			makePayload({
				types: [makeRow({ id: 1, name: "公告", displayOrder: 0, icon: "" })],
			}),
		);
		mockUpdate.mockResolvedValue(makeRow({ id: 1, name: "重要公告" }));
		render(<ForumThreadTypesPanel forumId={FORUM_ID} />);
		await expandAndWait();

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		});

		const nameInput = (await waitFor(() => {
			const el = document.querySelector("input[placeholder='分类名']");
			expect(el).not.toBeNull();
			return el as HTMLInputElement;
		})) as HTMLInputElement;
		await act(async () => {
			fireEvent.change(nameInput, { target: { value: "重要公告" } });
		});

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));
		});

		await waitFor(() => {
			expect(mockUpdate).toHaveBeenCalledTimes(1);
		});
		// Patch should ONLY contain the changed name — displayOrder/icon/
		// moderatorOnly stayed equal so they must not be in the body.
		expect(mockUpdate).toHaveBeenCalledWith(1, { name: "重要公告" });
	});

	it("delete (hard): removes the row + posts the deleted-message", async () => {
		mockFetch.mockResolvedValue(makePayload({ types: [makeRow({ id: 1, name: "公告" })] }));
		mockDelete.mockResolvedValue({ deleted: true, softDisabled: false, id: 1 });
		render(<ForumThreadTypesPanel forumId={FORUM_ID} />);
		await expandAndWait();

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "删除" }));
		});

		await waitFor(() => {
			expect(mockDelete).toHaveBeenCalledWith(1);
		});
		await waitFor(() => {
			// Hard-delete success message uses "已删除".
			expect(screen.queryByText(/已删除「公告」/)).not.toBeNull();
		});
	});

	it("delete (soft-disable): keeps row, flips enabled badge, surfaces threadCount message", async () => {
		mockFetch.mockResolvedValue(
			makePayload({ types: [makeRow({ id: 1, name: "公告", enabled: true })] }),
		);
		mockDelete.mockResolvedValue({
			deleted: false,
			softDisabled: true,
			id: 1,
			threadCount: 7,
		});
		render(<ForumThreadTypesPanel forumId={FORUM_ID} />);
		await expandAndWait();

		// Sanity: row currently rendered as 启用.
		expect(screen.getAllByText("启用").length).toBeGreaterThan(0);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "删除" }));
		});

		await waitFor(() => {
			// Soft-disable wording: keeps row visible, mentions threadCount.
			expect(screen.queryByText(/已停用「公告」/)).not.toBeNull();
		});
		const banner = screen.getByText(/已停用「公告」/).textContent ?? "";
		expect(banner).toContain("7");
		// Row label flipped to 已停用.
		expect(screen.queryAllByText("已停用").length).toBeGreaterThan(0);
	});

	it("reorder: ArrowDown on the first row sends the full re-ordered ID list", async () => {
		mockFetch.mockResolvedValue(
			makePayload({
				types: [
					makeRow({ id: 1, name: "A", displayOrder: 0 }),
					makeRow({ id: 2, name: "B", displayOrder: 1, sourceTypeid: 11 }),
					makeRow({ id: 3, name: "C", displayOrder: 2, sourceTypeid: 12 }),
				],
			}),
		);
		mockReorder.mockResolvedValue({ updated: true, count: 3 });
		render(<ForumThreadTypesPanel forumId={FORUM_ID} />);
		await expandAndWait("A");

		// First "下移" button = row #1 going from index 0 to 1.
		const downButtons = screen.getAllByRole("button", { name: "下移" });
		await act(async () => {
			fireEvent.click(downButtons[0]);
		});

		await waitFor(() => {
			expect(mockReorder).toHaveBeenCalledTimes(1);
		});
		expect(mockReorder).toHaveBeenCalledWith(FORUM_ID, [2, 1, 3]);
	});
});
