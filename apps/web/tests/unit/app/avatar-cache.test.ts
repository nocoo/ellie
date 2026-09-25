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
		"resolves fresh origin data and allows 60 seconds at the edge (%s)",
		async (query) => {
			mockAvatar("avatars/old.jpg", "old image");
			const before = await avatarRequest(query);
			expect(await before.text()).toBe("old image");
			expect(before.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
			expect(before.headers.get("Cloudflare-CDN-Cache-Control")).toBe("public, max-age=60");

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
		expect(fallback.headers.get("Cache-Control")).toBe("no-store");
		expect(fallback.headers.get("Cloudflare-CDN-Cache-Control")).toBe("no-store");

		mockAvatar("avatars/new.jpg", "new image");
		const recovered = await avatarRequest("?v=current");
		expect(await recovered.text()).toBe("new image");
		expect(recovered.headers.get("Content-Type")).toBe("image/jpeg");
	});
});

describe("avatar failure cache boundaries", () => {
	it.each([{}, { data: {} }, { data: { avatarPath: null } }, { data: { avatarPath: 42 } }])(
		"does not treat malformed avatar metadata as a known legacy avatar (%j)",
		async (metadata) => {
			fetchMock.mockResolvedValueOnce(Response.json(metadata));
			fetchMock.mockResolvedValueOnce(new Response("fallback"));
			const response = await avatarRequest("");
			expect(await response.text()).toBe("fallback");
			expect(response.headers.get("Cache-Control")).toBe("no-store");
			expect(response.headers.get("Cloudflare-CDN-Cache-Control")).toBe("no-store");
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(fetchMock).toHaveBeenLastCalledWith("https://t.no.mt/static/image/common/tavatar.gif");
		},
	);

	it.each(["missing-user", "cdn-error", "network-error", "fallback-error"])(
		"never caches %s",
		async (failure) => {
			if (failure === "missing-user" || failure === "fallback-error") {
				fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
			} else {
				fetchMock.mockResolvedValueOnce(Response.json({ data: { avatarPath: "avatars/new.jpg" } }));
				if (failure === "network-error") fetchMock.mockRejectedValueOnce(new Error("offline"));
				else fetchMock.mockResolvedValueOnce(new Response(null, { status: 502 }));
			}
			fetchMock.mockResolvedValueOnce(
				new Response("fallback", { status: failure === "fallback-error" ? 503 : 200 }),
			);
			const response = await avatarRequest("");
			expect(response.status).toBe(failure === "fallback-error" ? 503 : 200);
			expect(response.headers.get("Cache-Control")).toBe("no-store");
			expect(response.headers.get("Cloudflare-CDN-Cache-Control")).toBe("no-store");
		},
	);

	it.each(["invalid", "42junk", "0", "9007199254740992"])(
		"does not cache invalid UID %s",
		async (uid) => {
			const response = await GET(new NextRequest(`https://forum.example.test/api/avatar/${uid}`), {
				params: Promise.resolve({ uid }),
			});
			expect(response.status).toBe(307);
			expect(response.headers.get("Cache-Control")).toBe("no-store");
			expect(response.headers.get("Cloudflare-CDN-Cache-Control")).toBe("no-store");
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);
});
