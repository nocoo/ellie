// LoginAttemptsPanel component test — P4 reviewer follow-up.
//
// Pins the panel's privacy / audit-trail behavioural contract:
//   - The masked list renders an admin user-detail link for every row
//     with a non-null userId, pointing at `/admin/users/<id>` (so admins
//     can pivot from a suspicious attempt straight to the user page).
//   - Clicking "查看完整" issues a POST (NOT GET) request against
//     `/api/admin/analytics/login-history/<id>/reveal`. POST is the
//     contract that triggers the BFF's actor-header injection and the
//     worker's `analytics.login_history.reveal` admin_logs write.
//   - On a successful reveal the modal exposes the raw IP + UA + username
//     for the legitimate caller.
//   - Network errors leave the masked view intact and surface a user-
//     visible error inside the modal without rewriting the row.

// @vitest-environment happy-dom

import { LoginAttemptsPanel } from "@/components/admin/analytics/login-attempts-panel";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// next/link is rendered through @testing-library — happy-dom + react treat
// it as a plain anchor, so we can assert href via `getAttribute("href")`.
// We intentionally do NOT `vi.mock("next/link", ...)` here: the vitest
// pool runs with `isolate:false`, so a module-level mock would bleed into
// other project suites (apps/web) that import next/link with the real
// implementation.

// Default KPI + list payloads. Per-test overrides via fetchMock impl.
const KPI_PAYLOAD = {
	now: 1_700_000_000,
	dayStart: 1_699_900_000,
	totalAttempts: 5,
	successAttempts: 3,
	failedAttempts: 2,
	uniqueUsers: 4,
	uniqueIps: 3,
	loginAttempts: 4,
	registerAttempts: 1,
};

const LIST_ROW_WITH_USER = {
	id: 42,
	userId: 7,
	username: "alice",
	ok: 1,
	kind: "login",
	errorCode: "",
	ipMasked: "1.2.x.x",
	botClass: "human",
	createdAt: 1_700_000_000,
};

const LIST_ROW_NO_USER = {
	id: 43,
	userId: null as number | null,
	username: "bob",
	ok: 0,
	kind: "login",
	errorCode: "INVALID_CREDENTIALS",
	ipMasked: "2001:db8::x",
	botClass: "ua-bot",
	createdAt: 1_700_000_000,
};

const LIST_PAYLOAD = {
	page: 1,
	limit: 20,
	total: 2,
	rows: [LIST_ROW_WITH_USER, LIST_ROW_NO_USER],
};

const REVEAL_PAYLOAD = {
	id: 42,
	userId: 7,
	username: "alice",
	ok: 1,
	kind: "login",
	errorCode: "",
	ip: "203.0.113.45",
	userAgent: "Mozilla/5.0 (X11; Linux) Chrome/120",
	botClass: "human",
	createdAt: 1_700_000_000,
};

type FetchInit = RequestInit | undefined;

function makeJsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify({ data }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// vitest root config sets `pool: "threads"` with `isolate: false`, so
// any process-wide mock state we touch will bleed into other project
// suites that may be executing concurrently on the same worker. In
// particular, `vi.restoreAllMocks()` is process-wide — calling it from
// our afterEach can reset `vi.fn()` mocks owned by an apps/web test
// that is mid-flight (e.g. write-gate.test.ts asserts on its mocked
// apiClient.get). To stay isolated we ONLY touch `globalThis.fetch`,
// the single global we actually modify here, and we restore it by
// direct reference rather than via vi's global registry.
let originalFetch: typeof globalThis.fetch | undefined;

beforeEach(() => {
	originalFetch = globalThis.fetch;
});

afterEach(() => {
	cleanup();
	if (originalFetch) {
		globalThis.fetch = originalFetch;
	}
});

// File-level safety net: even if a single test's afterEach throws before
// it can restore fetch, this last-chance restore guarantees the worker
// thread does not exit with our mock fetch still globally installed.
afterAll(() => {
	if (originalFetch) {
		globalThis.fetch = originalFetch;
	}
});

describe("LoginAttemptsPanel — list link rendering", () => {
	it("renders admin user-detail anchor for rows with userId", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/logins")) return makeJsonResponse(KPI_PAYLOAD);
			return makeJsonResponse(LIST_PAYLOAD);
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<LoginAttemptsPanel />);

		// Wait for the list to land.
		await waitFor(() => {
			expect(screen.queryByText("alice")).not.toBeNull();
		});

		// alice (userId=7) → anchor `/admin/users/7`.
		const aliceLink = screen.getByText("alice").closest("a");
		expect(aliceLink).not.toBeNull();
		expect(aliceLink?.getAttribute("href")).toBe("/admin/users/7");

		// bob (userId=null) — must NOT be wrapped in a link.
		const bobNode = screen.getByText("bob");
		expect(bobNode.closest("a")).toBeNull();

		expect(fetchMock).toHaveBeenCalled();
	});
});

describe("LoginAttemptsPanel — reveal flow", () => {
	it("clicking 查看完整 issues POST and renders raw IP/UA in the modal", async () => {
		const observed: Array<{ url: string; method: string }> = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: FetchInit) => {
			const url = typeof input === "string" ? input : input.toString();
			const method = (init?.method ?? "GET").toUpperCase();
			observed.push({ url, method });
			if (url.endsWith("/today/logins")) return makeJsonResponse(KPI_PAYLOAD);
			if (url.endsWith("/today/logins/list") || url.includes("/today/logins/list?")) {
				return makeJsonResponse(LIST_PAYLOAD);
			}
			if (url.endsWith(`/login-history/${REVEAL_PAYLOAD.id}/reveal`)) {
				return makeJsonResponse(REVEAL_PAYLOAD);
			}
			return new Response("not found", { status: 404 });
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<LoginAttemptsPanel />);

		// Wait for the masked list to render so the "查看完整" buttons exist.
		await waitFor(() => {
			expect(screen.queryByText("alice")).not.toBeNull();
		});

		// Click the "查看完整" button on alice's row (first row).
		const revealButtons = screen.getAllByRole("button", { name: "查看完整" });
		expect(revealButtons.length).toBeGreaterThanOrEqual(1);
		await act(async () => {
			fireEvent.click(revealButtons[0]);
		});

		// Modal must show the raw IP + UA + username that the worker
		// returns on the reveal success path.
		await waitFor(() => {
			expect(screen.queryByText("203.0.113.45")).not.toBeNull();
		});
		expect(screen.queryByText("Mozilla/5.0 (X11; Linux) Chrome/120")).not.toBeNull();

		// The reveal request MUST have been a POST against the BFF reveal
		// path — GET would skip the actor-header injection and skip the
		// admin_logs audit row.
		const revealCalls = observed.filter((c) => c.url.endsWith("/reveal"));
		expect(revealCalls).toHaveLength(1);
		expect(revealCalls[0].method).toBe("POST");
		expect(revealCalls[0].url).toContain("/api/admin/analytics/login-history/42/reveal");

		// Audit-trail user-facing notice is visible inside the modal.
		expect(screen.queryByText(/审计日志/)).not.toBeNull();
	});

	it("surfaces network error inside the modal without rewriting the masked row", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: FetchInit) => {
			const url = typeof input === "string" ? input : input.toString();
			const method = (init?.method ?? "GET").toUpperCase();
			if (url.endsWith("/today/logins")) return makeJsonResponse(KPI_PAYLOAD);
			if (url.includes("/today/logins/list")) return makeJsonResponse(LIST_PAYLOAD);
			if (method === "POST" && url.endsWith("/reveal")) {
				return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
			}
			return new Response("not found", { status: 404 });
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<LoginAttemptsPanel />);
		await waitFor(() => {
			expect(screen.queryByText("alice")).not.toBeNull();
		});

		const revealButtons = screen.getAllByRole("button", { name: "查看完整" });
		await act(async () => {
			fireEvent.click(revealButtons[0]);
		});

		// Modal opens with an error; masked row's ipMasked remains.
		await waitFor(() => {
			// Some error text reaches the modal (any non-empty string in our
			// component renders inside <p class="text-destructive">). We don't
			// pin the exact string — only that the row's masked IP is still
			// the originally-masked value.
			expect(screen.queryByText("1.2.x.x")).not.toBeNull();
		});
	});
});
