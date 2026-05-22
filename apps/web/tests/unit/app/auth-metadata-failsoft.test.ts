import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));

vi.mock("@/viewmodels/forum/settings.server", () => ({
	fetchPublicSettings: vi.fn(),
	getStr: vi.fn((_s: any, _k: string, fallback: string) => fallback),
}));

import { fetchPublicSettings } from "@/viewmodels/forum/settings.server";

const mockFetch = fetchPublicSettings as ReturnType<typeof vi.fn>;

describe("auth page generateMetadata fail-soft", () => {
	it("login: returns fallback title when fetchPublicSettings throws", async () => {
		mockFetch.mockRejectedValue(new Error("Worker unreachable"));
		const { generateMetadata } = await import("@/app/(auth)/login/page");
		const meta = await generateMetadata();
		expect(meta.title).toBe("登录 - 同济网论坛");
	});

	it("register: returns fallback title when fetchPublicSettings throws", async () => {
		mockFetch.mockRejectedValue(new Error("Worker unreachable"));
		const { generateMetadata } = await import("@/app/(auth)/register/page");
		const meta = await generateMetadata();
		expect(meta.title).toBe("注册新账号 - 同济网论坛");
	});
});
