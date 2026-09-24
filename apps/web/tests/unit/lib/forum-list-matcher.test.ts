import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

it("runs Proxy on every forum route even when its dynamic id looks like an asset", async () => {
	vi.stubGlobal("AsyncLocalStorage", AsyncLocalStorage);
	const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server");
	const { config } = await import("@/proxy");
	for (const path of [
		"/forums/2",
		"/forums/2/3",
		"/forums/2.svg",
		"/forums/2.png",
		"/forums/2.ico",
	]) {
		expect(
			unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `https://local.test${path}` }),
		).toBe(true);
	}
	expect(
		unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "https://local.test/logo.png" }),
	).toBe(false);
});
