// LoginAttemptsPanel component test — P4 reviewer follow-up.
//
// Pins the panel's behavioural contract:
//   - The list renders an admin user-detail link for every row
//     with a non-null userId, pointing at `/admin/users/<id>`.
//   - Raw IP and UA are displayed directly in the table (no masking).

// @vitest-environment happy-dom

import { LoginAttemptsPanel } from "@/components/admin/analytics/login-attempts-panel";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
	ip: "203.0.113.45",
	userAgent: "Mozilla/5.0 (X11; Linux) Chrome/120",
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
	ip: "2001:db8:abcd:1234::5",
	userAgent: "curl/7.0",
	botClass: "ua-bot",
	createdAt: 1_700_000_000,
};

const LIST_PAYLOAD = {
	page: 1,
	limit: 20,
	total: 2,
	rows: [LIST_ROW_WITH_USER, LIST_ROW_NO_USER],
};

function makeJsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify({ data }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

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

afterAll(() => {
	if (originalFetch) {
		globalThis.fetch = originalFetch;
	}
});

describe("LoginAttemptsPanel — list rendering", () => {
	it("renders admin user-detail anchor for rows with userId", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/logins")) return makeJsonResponse(KPI_PAYLOAD);
			return makeJsonResponse(LIST_PAYLOAD);
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<LoginAttemptsPanel />);

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

	it("displays raw IP directly in the table without masking", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/logins")) return makeJsonResponse(KPI_PAYLOAD);
			return makeJsonResponse(LIST_PAYLOAD);
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<LoginAttemptsPanel />);

		await waitFor(() => {
			expect(screen.queryByText("203.0.113.45")).not.toBeNull();
		});
		expect(screen.queryByText("2001:db8:abcd:1234::5")).not.toBeNull();
	});

	it("displays UA in the table", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/today/logins")) return makeJsonResponse(KPI_PAYLOAD);
			return makeJsonResponse(LIST_PAYLOAD);
		});
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		render(<LoginAttemptsPanel />);

		await waitFor(() => {
			expect(screen.queryByText("Mozilla/5.0 (X11; Linux) Chrome/120")).not.toBeNull();
		});
	});
});
