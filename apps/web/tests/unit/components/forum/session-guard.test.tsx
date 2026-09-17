// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { useSession } from "next-auth/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGuard } from "@/components/forum/session-guard";
import * as writeGate from "@/viewmodels/forum/write-gate";

vi.mock("next-auth/react", () => ({
	useSession: vi.fn(),
	signOut: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
	apiClient: {
		get: vi.fn(),
		post: vi.fn(),
		delete: vi.fn(),
	},
}));

describe("SessionGuard — write-gate scope synchronization", () => {
	let setScopeSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		writeGate.invalidateWriteGateCache();
		setScopeSpy = vi.spyOn(writeGate, "setWriteGateScope");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("does not include transient status in settled user scope, preventing spurious scope changes", () => {
		const mockSession = {
			user: {
				id: 10,
				role: 0,
				provider: "credentials",
			},
			error: undefined,
		};

		// 1. Initial render with session loading
		vi.mocked(useSession).mockReturnValue({
			data: undefined,
			status: "loading",
			update: vi.fn(),
		});

		const { rerender } = render(<SessionGuard />);
		expect(setScopeSpy).toHaveBeenCalledWith("loading");

		// 2. Session resolves to authenticated user
		setScopeSpy.mockClear();
		vi.mocked(useSession).mockReturnValue({
			data: mockSession as unknown as ReturnType<typeof useSession>["data"],
			status: "authenticated",
			update: vi.fn(),
		});

		rerender(<SessionGuard />);
		expect(setScopeSpy).toHaveBeenCalledWith("credentials:10:0:ok");

		// 3. Status remains authenticated (or rerender occurs) -> scope unchanged, setWriteGateScope not called again
		setScopeSpy.mockClear();
		rerender(<SessionGuard />);
		expect(setScopeSpy).not.toHaveBeenCalled();
	});

	it("preserves an in-flight checkWriteGate through authenticated -> loading -> authenticated transitions for the same user", async () => {
		const { apiClient } = await import("@/lib/api-client");
		const mockClient = apiClient as { get: ReturnType<typeof vi.fn> };
		mockClient.get.mockClear();

		let finish!: (val: unknown) => void;
		mockClient.get.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);

		const sessionUser = { id: 10, role: 0, provider: "credentials" };

		// 1. Initial authenticated render
		vi.mocked(useSession).mockReturnValue({
			data: { user: sessionUser, error: undefined } as unknown as ReturnType<
				typeof useSession
			>["data"],
			status: "authenticated",
			update: vi.fn(),
		});
		const { rerender } = render(<SessionGuard />);

		// 2. Start a write-gate check while authenticated
		const checkPromise = writeGate.checkWriteGate(null, "thread");
		expect(mockClient.get).toHaveBeenCalledTimes(1);

		// 3. Transient loading state (e.g. background session refresh) with retained session data
		vi.mocked(useSession).mockReturnValue({
			data: { user: sessionUser, error: undefined } as unknown as ReturnType<
				typeof useSession
			>["data"],
			status: "loading",
			update: vi.fn(),
		});
		rerender(<SessionGuard />);

		// 4. Transient loading state where session data is undefined
		vi.mocked(useSession).mockReturnValue({
			data: undefined,
			status: "loading",
			update: vi.fn(),
		});
		rerender(<SessionGuard />);

		// 5. Returns to authenticated with same user
		vi.mocked(useSession).mockReturnValue({
			data: { user: sessionUser, error: undefined } as unknown as ReturnType<
				typeof useSession
			>["data"],
			status: "authenticated",
			update: vi.fn(),
		});
		rerender(<SessionGuard />);

		// 6. Complete the original in-flight request
		finish({ data: { allowed: true } });

		// Should resolve without SESSION_CHANGED error and without needing a second API call
		const result = await checkPromise;
		expect(result).toEqual({ blocked: false });
		expect(mockClient.get).toHaveBeenCalledTimes(1);
	});

	it.each([
		{ change: "role", nextId: 10, nextRole: 1 },
		{ change: "account", nextId: 20, nextRole: 0 },
		{ change: "logout", nextId: null, nextRole: 0 },
	])("fences a pending allowed result after $change", async ({ nextId, nextRole }) => {
		const { apiClient } = await import("@/lib/api-client");
		const mockClient = apiClient as { get: ReturnType<typeof vi.fn> };
		mockClient.get.mockClear();

		let finish!: (val: unknown) => void;
		mockClient.get.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);

		// 1. Start authenticated as user 10
		vi.mocked(useSession).mockReturnValue({
			data: {
				user: { id: 10, role: 0, provider: "credentials" },
			} as unknown as ReturnType<typeof useSession>["data"],
			status: "authenticated",
			update: vi.fn(),
		});
		const { rerender } = render(<SessionGuard />);

		// 2. Start checkWriteGate
		const checkPromise = writeGate.checkWriteGate(null, "thread");

		// 3. Change the account, role, or authenticated state while the request is pending.
		vi.mocked(useSession).mockReturnValue({
			data: (nextId === null
				? null
				: {
						user: { id: nextId, role: nextRole, provider: "credentials" },
					}) as unknown as ReturnType<typeof useSession>["data"],
			status: nextId === null ? "unauthenticated" : "authenticated",
			update: vi.fn(),
		});
		rerender(<SessionGuard />);

		// 4. Old in-flight request finishes
		finish({ data: { allowed: true } });

		// Must be fenced with SESSION_CHANGED
		const result = await checkPromise;
		expect(result).toMatchObject({ blocked: true, code: "SESSION_CHANGED" });
	});

	it("updates write-gate scope on actual account change or signout", () => {
		vi.mocked(useSession).mockReturnValue({
			data: {
				user: { id: 10, role: 0, provider: "credentials" },
			} as unknown as ReturnType<typeof useSession>["data"],
			status: "authenticated",
			update: vi.fn(),
		});

		const { rerender } = render(<SessionGuard />);
		expect(setScopeSpy).toHaveBeenCalledWith("credentials:10:0:ok");

		// Sign out -> unauthenticated
		setScopeSpy.mockClear();
		vi.mocked(useSession).mockReturnValue({
			data: null,
			status: "unauthenticated",
			update: vi.fn(),
		});

		rerender(<SessionGuard />);
		expect(setScopeSpy).toHaveBeenCalledWith("unauthenticated");
	});
});
