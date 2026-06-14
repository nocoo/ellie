// tests/integration/http/ip-lookup.test.ts — L2 Worker admin ip-lookup
// Covers GET /api/admin/ip-lookup added in Phase G.6.
//
// L2 environment does NOT set `IP_LOOKUP_API_KEY` (the upstream secret
// only lives in the deployed Worker via `wrangler secret put`), so the
// success path is unreachable here. Coverage strategy:
//   - Validation branch: missing / private / malformed → 400 INVALID_IP
//     with `details.reason` discriminator.
//   - Configuration branch: a valid public IP without the secret → 503
//     IP_LOOKUP_NOT_CONFIGURED, proving the route is wired and reaches
//     the secret check after validation.
//
// The upstream fetch path itself (cache miss + echo.nocoo.cloud call +
// 8KB raw guard) is exercised by the unit-level handler test.

import { describe, expect, test } from "bun:test";
import { adminGet } from "../setup";

describe("L2: Worker Admin IP Lookup", () => {
	test("missing ip → 400 INVALID_IP reason=missing", async () => {
		const res = await adminGet("/api/admin/ip-lookup");
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error?: { code?: string; details?: { reason?: string } } };
		expect(body.error?.code).toBe("INVALID_IP");
		expect(body.error?.details?.reason).toBe("missing");
	});

	test("private 10/8 → 400 INVALID_IP reason=private", async () => {
		const res = await adminGet("/api/admin/ip-lookup?ip=10.0.0.1");
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error?: { details?: { reason?: string } } };
		expect(body.error?.details?.reason).toBe("private");
	});

	test("malformed → 400 INVALID_IP reason=malformed", async () => {
		const res = await adminGet("/api/admin/ip-lookup?ip=not-an-ip");
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error?: { details?: { reason?: string } } };
		expect(body.error?.details?.reason).toBe("malformed");
	});

	test("valid public IP without secret → 503 IP_LOOKUP_NOT_CONFIGURED", async () => {
		const res = await adminGet("/api/admin/ip-lookup?ip=8.8.8.8");
		expect(res.status).toBe(503);
		const body = (await res.json()) as { error?: { code?: string } };
		expect(body.error?.code).toBe("IP_LOOKUP_NOT_CONFIGURED");
	});
});
