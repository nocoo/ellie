// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { SessionContext, type SessionContextValue } from "next-auth/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComposerDraft } from "@/viewmodels/forum/use-composer-draft";

let account = "100";
let loading = false;
function wrapper({ children }: { children: ReactNode }) {
	const value: SessionContextValue = loading
		? { data: null, status: "loading", update: vi.fn() }
		: {
				data: {
					user: { id: account, name: "Tester", provider: "credentials" },
					expires: "2099-01-01",
				},
				status: "authenticated",
				update: vi.fn(),
			};
	return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

beforeEach(() => {
	account = "100";
	loading = false;
	sessionStorage.clear();
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("composer drafts", () => {
	it("restores rich content, title and category after remount and clears only on request", () => {
		const first = renderHook(() => useComposerDraft("thread:1"), { wrapper });
		act(() => {
			first.result.current.update({ subject: "A saved title" });
			first.result.current.update({ content: "<p>中文 <strong>draft</strong></p>", typeId: 3 });
		});
		expect(first.result.current.status).toBe("saved");
		first.unmount();
		const second = renderHook(() => useComposerDraft("thread:1"), { wrapper });
		expect(second.result.current.draft).toEqual({
			subject: "A saved title",
			content: "<p>中文 <strong>draft</strong></p>",
			typeId: 3,
		});
		expect(second.result.current.status).toBe("restored");
		act(() => second.result.current.clear());
		expect(sessionStorage.getItem("ellie:composer:100:thread:1")).toBeNull();
		expect(second.result.current.draft.content).toBe("");
	});

	it("isolates accounts and locations when a mounted composer changes context", () => {
		const { result, rerender } = renderHook(({ scope }) => useComposerDraft(scope), {
			wrapper,
			initialProps: { scope: "reply:1:alice" },
		});
		act(() => result.current.update({ content: "Alice draft" }));
		rerender({ scope: "reply:1:bob" });
		expect(result.current.draft.content).toBe("");
		act(() => result.current.update({ content: "Bob draft" }));
		rerender({ scope: "reply:1:alice" });
		expect(result.current.draft.content).toBe("Alice draft");
		account = "200";
		rerender({ scope: "reply:1:alice" });
		expect(result.current.draft.content).toBe("");
		account = "100";
		rerender({ scope: "reply:1:alice" });
		expect(result.current.draft.content).toBe("Alice draft");
	});

	it("waits for the account before showing the editor", () => {
		loading = true;
		sessionStorage.setItem(
			"ellie:composer:100:thread:1",
			JSON.stringify({ content: "Restored", subject: "Title", typeId: null }),
		);
		const { result, rerender } = renderHook(() => useComposerDraft("thread:1"), { wrapper });
		expect(result.current.ready).toBe(false);
		loading = false;
		rerender();
		expect(result.current.ready).toBe(true);
		expect(result.current.draft.content).toBe("Restored");
	});

	it("keeps in-memory writing usable when persistence is unavailable", () => {
		vi.stubGlobal("sessionStorage", {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("quota");
			},
			removeItem: () => {
				throw new Error("blocked");
			},
		});
		const { result } = renderHook(() => useComposerDraft("thread:1"), { wrapper });
		expect(result.current.status).toBe("unavailable");
		expect(result.current.ready).toBe(true);
		act(() => result.current.update({ content: "Do not lose this" }));
		expect(result.current.draft.content).toBe("Do not lose this");
		expect(result.current.status).toBe("unavailable");
		act(() => result.current.clear());
		expect(result.current.draft.content).toBe("");
	});

	it.each([
		"null",
		"[]",
		"{}",
		'{"content":1,"subject":"","typeId":null}',
		'{"content":"","subject":1,"typeId":null}',
		'{"content":"","subject":""}',
		'{"content":"","subject":"","typeId":-1}',
		'{"content":"","subject":"","typeId":1.5}',
		'{"content":"","subject":"","typeId":"1"}',
	])("ignores invalid saved data: %s", (value) => {
		sessionStorage.setItem("ellie:composer:100:thread:1", value);
		const { result } = renderHook(() => useComposerDraft("thread:1"), { wrapper });
		expect(result.current.draft).toEqual({ subject: "", content: "", typeId: null });
		expect(result.current.ready).toBe(true);
	});

	it("recovers from malformed JSON on the next edit", () => {
		sessionStorage.setItem("ellie:composer:100:thread:1", "{");
		const { result } = renderHook(() => useComposerDraft("thread:1"), { wrapper });
		expect(result.current.status).toBe("unavailable");
		act(() => result.current.update({ content: "Recovered" }));
		expect(result.current.status).toBe("saved");
	});

	it("refreshes an edit composer after the saved post changes", () => {
		const { result, rerender } = renderHook(
			({ content }) => useComposerDraft("edit:1", { content, subject: "", typeId: null }),
			{ wrapper, initialProps: { content: "Original" } },
		);
		act(() => result.current.update({ content: "Changed" }));
		act(() => result.current.clear());
		rerender({ content: "Saved on server" });
		expect(result.current.draft.content).toBe("Saved on server");
	});

	it("supports an in-memory composer without an account", () => {
		const { result } = renderHook(() => useComposerDraft("anonymous"));
		act(() => result.current.update({ content: "In memory" }));
		expect(result.current.draft.content).toBe("In memory");
		expect(sessionStorage.length).toBe(0);
		act(() => result.current.clear());
		expect(result.current.draft.content).toBe("");
	});
});
