import { describe, expect, it, vi } from "vitest";
import { createEntityHandlers, withEntityAuth } from "../../../src/lib/adminHelpers";
import type { EntityConfig } from "../../../src/lib/crud";
import type { Env } from "../../../src/lib/env";
import { makeEnv } from "../../helpers";

// ─── Fixtures ──────────────────────────────────────────────

const adminConfig: EntityConfig = {
	table: "test",
	entityName: "TEST",
	auth: "admin",
	columns: "*",
	mapper: (r) => r,
};

const modConfig: EntityConfig = {
	table: "test",
	entityName: "TEST",
	auth: "moderator",
	columns: "*",
	mapper: (r) => r,
};

function makeRequest(): Request {
	return new Request("https://api.example.com/api/admin/test");
}

// ─── withEntityAuth ────────────────────────────────────────

describe("withEntityAuth", () => {
	const env = makeEnv();

	it("should call handler with (request, env) as a pass-through wrapper", async () => {
		const handler = vi.fn(async (_req: Request, _env: Env) => new Response("ok"));
		const wrapped = withEntityAuth(adminConfig, handler);
		const req = makeRequest();
		const res = await wrapped(req, env);

		expect(res.status).toBe(200);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith(req, env);
	});

	it("should return the handler's response directly", async () => {
		const handler = vi.fn(
			async (_req: Request, _env: Env) =>
				new Response(JSON.stringify({ data: "test" }), { status: 200 }),
		);
		const wrapped = withEntityAuth(adminConfig, handler);
		const res = await wrapped(makeRequest(), env);

		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: string };
		expect(body.data).toBe("test");
	});

	it("should work with moderator config (same pass-through behavior)", async () => {
		const handler = vi.fn(async (_req: Request, _env: Env) => new Response("mod-ok"));
		const wrapped = withEntityAuth(modConfig, handler);
		const res = await wrapped(makeRequest(), env);

		expect(res.status).toBe(200);
		expect(handler).toHaveBeenCalledTimes(1);
	});
});

// ─── createEntityHandlers ──────────────────────────────────

describe("createEntityHandlers", () => {
	const env = makeEnv();

	it("should wrap all handlers with withEntityAuth", async () => {
		const listHandler = vi.fn(async (_req: Request, _env: Env) => new Response("list"));
		const getHandler = vi.fn(async (_req: Request, _env: Env) => new Response("get"));

		const wrapped = createEntityHandlers(adminConfig, { list: listHandler, get: getHandler });

		expect(wrapped.list).toBeDefined();
		expect(wrapped.get).toBeDefined();

		// Should pass through to handler
		const res = await wrapped.list(makeRequest(), env);
		expect(res.status).toBe(200);
		expect(listHandler).toHaveBeenCalledTimes(1);
	});

	it("should pass request and env to wrapped handlers", async () => {
		const handler = vi.fn(async (_req: Request, _env: Env) => new Response("ok"));
		const wrapped = createEntityHandlers(adminConfig, { action: handler });
		const req = makeRequest();

		const res = await wrapped.action(req, env);
		expect(res.status).toBe(200);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith(req, env);
	});
});
