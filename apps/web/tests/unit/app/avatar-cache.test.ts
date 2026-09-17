import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/avatar/[uid]/route";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
	vi.stubEnv("WORKER_API_URL", "https://worker.example.test");
	vi.stubEnv("FORUM_API_KEY", "test-key");
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

function avatarRequest(query: string) {
	return GET(new NextRequest(`https://forum.example.test/api/avatar/42${query}`), {
		params: Promise.resolve({ uid: "42" }),
	});
}

function mockAvatar(path: string, contents: string) {
	fetchMock.mockResolvedValueOnce(Response.json({ data: { avatarPath: path } }));
	fetchMock.mockResolvedValueOnce(
		new Response(contents, { headers: { "Content-Type": "image/jpeg" } }),
	);
}

describe("mutable avatar proxy caching", () => {
	it.each(["", "?v=current", "?v=1789600000000"])(
		"revalidates the latest saved avatar on repeat requests (%s)",
		async (query) => {
			mockAvatar("avatars/old.jpg", "old image");
			const before = await avatarRequest(query);
			expect(await before.text()).toBe("old image");
			expect(before.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");

			mockAvatar("avatars/new.jpg", "new image");
			const after = await avatarRequest(query);
			expect(await after.text()).toBe("new image");
			expect(after.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
			expect(fetchMock).toHaveBeenNthCalledWith(
				3,
				"https://worker.example.test/api/v1/users/42/avatar-path",
				expect.objectContaining({ cache: "no-store" }),
			);
			expect(fetchMock).toHaveBeenLastCalledWith(
				"https://t.no.mt/avatars/new.jpg",
				expect.any(Object),
			);
		},
	);

	it("does not leave a temporary fallback cached after the Worker recovers", async () => {
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
		fetchMock.mockResolvedValueOnce(new Response("fallback"));
		const fallback = await avatarRequest("?v=current");
		expect(await fallback.text()).toBe("fallback");
		expect(fallback.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");

		mockAvatar("avatars/new.jpg", "new image");
		const recovered = await avatarRequest("?v=current");
		expect(await recovered.text()).toBe("new image");
		expect(recovered.headers.get("Content-Type")).toBe("image/jpeg");
	});
});
