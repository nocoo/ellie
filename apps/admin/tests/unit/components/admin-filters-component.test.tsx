// AdminFilters component test — Phase H.2.1.
//
// The pure-helper coverage lives in `admin-filters.test.ts`. This file
// exists to pin the runtime behaviour that pure helpers can't express:
//
//   - Multiple `type: "search"` filters are independent buffers and
//     emit their own `filter.key` on submit / clear. The earlier
//     implementation shared a single `searchInput` state and hard-
//     coded `"search"` in both submit and clear, so the second box
//     was silently broken — typing into "authorName" would either do
//     nothing (no submit binding) or overwrite the wrong key. Pin
//     that here so a future regression trips this test instead of
//     making the H.2 author filter non-functional on the UI again.
//   - Local input state is "pending until submit": keystrokes do
//     NOT propagate to the parent. Only Enter (form submit) and the
//     inline `<X>` clear button push values up.
//   - Parent-driven clears (e.g. "清除筛选" wipes `values[key]`)
//     visibly empty the input — input ↔ parent values are kept in
//     sync in the parent→local direction.

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminFilters, type FilterDef } from "@/components/admin/admin-filters";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(() => {
	cleanup();
});

const SEARCH_FILTERS: FilterDef[] = [
	{ key: "search", label: "搜索主题...", type: "search" },
	{ key: "authorName", label: "作者名称...", type: "search" },
];

describe("AdminFilters — multiple search filters", () => {
	it("renders one input per search filter with distinct placeholders", () => {
		render(
			<AdminFilters
				filters={SEARCH_FILTERS}
				values={{ search: "", authorName: "" }}
				onFilterChange={() => {}}
			/>,
		);
		// Two separate inputs — placeholders are the only stable handle.
		expect(screen.getByPlaceholderText("搜索主题...")).not.toBeNull();
		expect(screen.getByPlaceholderText("作者名称...")).not.toBeNull();
	});

	it("submitting the subject form fires onFilterChange('search', value) only", () => {
		const onFilterChange = vi.fn();
		render(
			<AdminFilters
				filters={SEARCH_FILTERS}
				values={{ search: "", authorName: "" }}
				onFilterChange={onFilterChange}
			/>,
		);
		const subjectInput = screen.getByPlaceholderText("搜索主题...") as HTMLInputElement;
		act(() => {
			fireEvent.change(subjectInput, { target: { value: "hello" } });
		});
		// Typing alone does NOT propagate — input is pending until submit.
		expect(onFilterChange).not.toHaveBeenCalled();
		// Submit the parent <form> for that input.
		act(() => {
			fireEvent.submit(subjectInput.closest("form") as HTMLFormElement);
		});
		expect(onFilterChange).toHaveBeenCalledTimes(1);
		expect(onFilterChange).toHaveBeenCalledWith("search", "hello");
	});

	it("submitting the author form fires onFilterChange('authorName', value) only", () => {
		const onFilterChange = vi.fn();
		render(
			<AdminFilters
				filters={SEARCH_FILTERS}
				values={{ search: "", authorName: "" }}
				onFilterChange={onFilterChange}
			/>,
		);
		const authorInput = screen.getByPlaceholderText("作者名称...") as HTMLInputElement;
		act(() => {
			fireEvent.change(authorInput, { target: { value: "alice" } });
		});
		act(() => {
			fireEvent.submit(authorInput.closest("form") as HTMLFormElement);
		});
		// Critical regression pin: the previous implementation wrote to
		// the hard-coded "search" key here.
		expect(onFilterChange).toHaveBeenCalledTimes(1);
		expect(onFilterChange).toHaveBeenCalledWith("authorName", "alice");
	});

	it("two boxes hold independent buffers — typing in one does not bleed into the other", () => {
		render(
			<AdminFilters
				filters={SEARCH_FILTERS}
				values={{ search: "", authorName: "" }}
				onFilterChange={() => {}}
			/>,
		);
		const subjectInput = screen.getByPlaceholderText("搜索主题...") as HTMLInputElement;
		const authorInput = screen.getByPlaceholderText("作者名称...") as HTMLInputElement;
		act(() => {
			fireEvent.change(subjectInput, { target: { value: "hello" } });
		});
		act(() => {
			fireEvent.change(authorInput, { target: { value: "alice" } });
		});
		expect(subjectInput.value).toBe("hello");
		expect(authorInput.value).toBe("alice");
	});

	it("the inline X-clear button on one input clears only that filter key", () => {
		const onFilterChange = vi.fn();
		const { rerender } = render(
			<AdminFilters
				filters={SEARCH_FILTERS}
				// `values.authorName` is pre-populated to simulate a previously-submitted author filter.
				values={{ search: "", authorName: "alice" }}
				onFilterChange={onFilterChange}
			/>,
		);
		// Type something in subject so the X button renders there too.
		const subjectInput = screen.getByPlaceholderText("搜索主题...") as HTMLInputElement;
		act(() => {
			fireEvent.change(subjectInput, { target: { value: "hello" } });
		});
		// Re-render same props (no value change yet) to keep things sane.
		rerender(
			<AdminFilters
				filters={SEARCH_FILTERS}
				values={{ search: "", authorName: "alice" }}
				onFilterChange={onFilterChange}
			/>,
		);
		// Now click the author input's X — should clear ONLY authorName.
		const authorClear = screen.getByLabelText("清除作者名称...");
		act(() => {
			fireEvent.click(authorClear);
		});
		expect(onFilterChange).toHaveBeenCalledTimes(1);
		expect(onFilterChange).toHaveBeenCalledWith("authorName", "");
	});

	it("when parent clears values[key] to '', the input visibly empties (parent→local sync)", () => {
		const { rerender } = render(
			<AdminFilters
				filters={SEARCH_FILTERS}
				values={{ search: "hello", authorName: "alice" }}
				onFilterChange={() => {}}
			/>,
		);
		// Local buffers seed from values on mount.
		const subjectInput = screen.getByPlaceholderText("搜索主题...") as HTMLInputElement;
		const authorInput = screen.getByPlaceholderText("作者名称...") as HTMLInputElement;
		expect(subjectInput.value).toBe("hello");
		expect(authorInput.value).toBe("alice");

		// Parent clears everything (e.g. "清除筛选" handler).
		rerender(
			<AdminFilters
				filters={SEARCH_FILTERS}
				values={{ search: "", authorName: "" }}
				onFilterChange={() => {}}
			/>,
		);
		expect(subjectInput.value).toBe("");
		expect(authorInput.value).toBe("");
	});
});
