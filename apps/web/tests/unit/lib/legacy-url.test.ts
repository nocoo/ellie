// Unit tests for `lib/legacy-url.ts` — the unified Discuz → canonical
// URL resolver mounted in `proxy.ts`.
//
// Coverage targets (reviewer pin msg 57eeb911 / 56498717):
//   - All 4 legacy shapes (A: forum-N-N.html, B: thread-N-N-N.html,
//     C: forum.php?mod=forumdisplay, D: forum.php?mod=viewthread)
//   - Both query-page canonicalize shapes (E: /forums/:id?page=N,
//     F: /threads/:id?page=N)
//   - Both path-segment page=1 canonicalize shapes (G: /forums/:id/1,
//     H: /threads/:id/1)
//   - returnTo trust-edge (independent ?fid only; never derived from
//     `extra`)
//   - Query whitelist (extra/mobile/from/fromuid/cursor/etc. dropped)
//   - Non-matching paths return null
//   - Defense against malformed ids (leading zero, negatives, non-int)
//
// All inputs are constructed via `new URL(...)` so we test the exact
// shape the proxy passes (`request.nextUrl`).

import { describe, expect, it } from "vitest";

import { resolveLegacyDiscuzRedirect } from "@/lib/legacy-url";

const ORIGIN = "https://example.com";
function u(path: string): URL {
	return new URL(path, ORIGIN);
}

describe("resolveLegacyDiscuzRedirect — A: /forum-:fid-:page.html", () => {
	it("page 1 → bare /forums/:fid", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forum-306-1.html"))).toEqual({
			destination: "/forums/306",
		});
	});

	it("page >= 2 → /forums/:fid/:page", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forum-306-3.html"))).toEqual({
			destination: "/forums/306/3",
		});
	});

	it("non-positive page → bare path (page route 404s if bogus)", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forum-306-0.html"))).toEqual({
			destination: "/forums/306",
		});
	});

	it("non-numeric file does not match", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forum-abc-1.html"))).toBeNull();
		expect(resolveLegacyDiscuzRedirect(u("/forum-306-1.htm"))).toBeNull();
	});
});

describe("resolveLegacyDiscuzRedirect — B: /thread-:tid-:page-:extra.html", () => {
	it("page 1 → bare /threads/:tid (extra dropped)", () => {
		expect(resolveLegacyDiscuzRedirect(u("/thread-276060-1-1.html"))).toEqual({
			destination: "/threads/276060",
		});
	});

	it("page >= 2 → /threads/:tid/:page (NO returnTo from extra)", () => {
		// extra segment 999 is the Discuz internal hash, never a forum id.
		expect(resolveLegacyDiscuzRedirect(u("/thread-276060-3-999.html"))).toEqual({
			destination: "/threads/276060/3",
		});
	});

	it("missing extra segment does not match (strict 3-group regex)", () => {
		expect(resolveLegacyDiscuzRedirect(u("/thread-276060-1.html"))).toBeNull();
	});
});

describe("resolveLegacyDiscuzRedirect — C: /forum.php?mod=forumdisplay", () => {
	it("no page → bare /forums/:fid", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forum.php?mod=forumdisplay&fid=134"))).toEqual({
			destination: "/forums/134",
		});
	});

	it("page 1 → bare /forums/:fid", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forum.php?mod=forumdisplay&fid=134&page=1"))).toEqual({
			destination: "/forums/134",
		});
	});

	it("page >= 2 → /forums/:fid/:page", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forum.php?mod=forumdisplay&fid=134&page=4"))).toEqual({
			destination: "/forums/134/4",
		});
	});

	it("drops junk query (mobile/from/fromuid/typeId)", () => {
		expect(
			resolveLegacyDiscuzRedirect(
				u("/forum.php?mod=forumdisplay&fid=134&page=2&mobile=2&from=portal&fromuid=99&typeId=11"),
			),
		).toEqual({ destination: "/forums/134/2" });
	});

	it("missing fid returns null", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forum.php?mod=forumdisplay"))).toBeNull();
	});

	it("non-positive fid returns null", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forum.php?mod=forumdisplay&fid=0"))).toBeNull();
	});
});

describe("resolveLegacyDiscuzRedirect — D: /forum.php?mod=viewthread", () => {
	it("no page, no fid → bare /threads/:tid (no returnTo)", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forum.php?mod=viewthread&tid=923066"))).toEqual({
			destination: "/threads/923066",
		});
	});

	it("page >= 2 → /threads/:tid/:page", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forum.php?mod=viewthread&tid=923066&page=2"))).toEqual({
			destination: "/threads/923066/2",
		});
	});

	it("fid present → adds returnTo percent-encoded", () => {
		expect(
			resolveLegacyDiscuzRedirect(u("/forum.php?mod=viewthread&tid=923066&page=2&fid=306")),
		).toEqual({ destination: "/threads/923066/2?returnTo=%2Fforums%2F306" });
	});

	it("fid present, page 1 → bare path with returnTo", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forum.php?mod=viewthread&tid=923066&fid=306"))).toEqual({
			destination: "/threads/923066?returnTo=%2Fforums%2F306",
		});
	});

	it("malformed fid (non-positive) does NOT produce returnTo", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forum.php?mod=viewthread&tid=923066&fid=0"))).toEqual({
			destination: "/threads/923066",
		});
		expect(resolveLegacyDiscuzRedirect(u("/forum.php?mod=viewthread&tid=923066&fid=-5"))).toEqual({
			destination: "/threads/923066",
		});
	});

	it("`extra` query is never used to derive returnTo", () => {
		// extra=page%3D1 is Discuz's nested encoded form. Even with no
		// explicit independent fid, returnTo MUST NOT appear.
		expect(
			resolveLegacyDiscuzRedirect(u("/forum.php?mod=viewthread&tid=923066&extra=page%3D1")),
		).toEqual({ destination: "/threads/923066" });
	});

	it("drops mobile/from/fromuid noise", () => {
		expect(
			resolveLegacyDiscuzRedirect(
				u("/forum.php?mod=viewthread&tid=923066&page=2&fid=306&mobile=2&from=portal&fromuid=99"),
			),
		).toEqual({ destination: "/threads/923066/2?returnTo=%2Fforums%2F306" });
	});

	it("unknown mod returns null", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forum.php?mod=other&fid=1"))).toBeNull();
	});

	it("missing tid returns null", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forum.php?mod=viewthread"))).toBeNull();
	});
});

describe("resolveLegacyDiscuzRedirect — E: /forums/:fid?page=N (query → segment)", () => {
	it("page >= 2 → /forums/:fid/:page", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/306?page=2"))).toEqual({
			destination: "/forums/306/2",
		});
	});

	it("page 1 → bare path", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/306?page=1"))).toEqual({
			destination: "/forums/306",
		});
	});

	it("trailing slash + ?page=N still matches", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/306/?page=2"))).toEqual({
			destination: "/forums/306/2",
		});
	});

	it("bare /forums/:fid (no ?page=) returns null (canonical, fall-through)", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/306"))).toBeNull();
	});

	it("non-numeric page param → coerced to bare path", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/306?page=abc"))).toEqual({
			destination: "/forums/306",
		});
	});

	it("preserves typeId on the redirect (?page=N&typeId=M → /:N?typeId=M)", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/306?page=2&typeId=11"))).toEqual({
			destination: "/forums/306/2?typeId=11",
		});
	});

	it("preserves typeId on the page=1 bare redirect", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/306?page=1&typeId=11"))).toEqual({
			destination: "/forums/306?typeId=11",
		});
	});

	it("drops non-allowlisted query (mobile/from/fromuid/evil)", () => {
		expect(
			resolveLegacyDiscuzRedirect(u("/forums/306?page=2&mobile=2&from=portal&fromuid=99&evil=1")),
		).toEqual({ destination: "/forums/306/2" });
	});

	it("drops malformed typeId (non-positive / leading zero)", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/306?page=2&typeId=0"))).toEqual({
			destination: "/forums/306/2",
		});
		expect(resolveLegacyDiscuzRedirect(u("/forums/306?page=2&typeId=-3"))).toEqual({
			destination: "/forums/306/2",
		});
		expect(resolveLegacyDiscuzRedirect(u("/forums/306?page=2&typeId=01"))).toEqual({
			destination: "/forums/306/2",
		});
		expect(resolveLegacyDiscuzRedirect(u("/forums/306?page=2&typeId=abc"))).toEqual({
			destination: "/forums/306/2",
		});
	});

	it("drops empty typeId", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/306?page=2&typeId="))).toEqual({
			destination: "/forums/306/2",
		});
	});
});

describe("resolveLegacyDiscuzRedirect — F: /threads/:tid?page=N (query → segment)", () => {
	it("page >= 2 → /threads/:tid/:page (no returnTo)", () => {
		expect(resolveLegacyDiscuzRedirect(u("/threads/923066?page=2"))).toEqual({
			destination: "/threads/923066/2",
		});
	});

	it("page 1 → bare path", () => {
		expect(resolveLegacyDiscuzRedirect(u("/threads/923066?page=1"))).toEqual({
			destination: "/threads/923066",
		});
	});

	it("bare /threads/:tid (no ?page=) returns null", () => {
		expect(resolveLegacyDiscuzRedirect(u("/threads/923066"))).toBeNull();
	});

	it("preserves canonical returnTo (?page=N&returnTo=/forums/M → /:N?returnTo=/forums/M)", () => {
		expect(
			resolveLegacyDiscuzRedirect(u("/threads/923066?page=2&returnTo=%2Fforums%2F306")),
		).toEqual({ destination: "/threads/923066/2?returnTo=%2Fforums%2F306" });
	});

	it("preserves canonical returnTo on page=1 bare redirect", () => {
		expect(
			resolveLegacyDiscuzRedirect(u("/threads/923066?page=1&returnTo=%2Fforums%2F306")),
		).toEqual({ destination: "/threads/923066?returnTo=%2Fforums%2F306" });
	});

	it("preserves /forums/:fid/:page returnTo (page >= 2 form)", () => {
		expect(
			resolveLegacyDiscuzRedirect(u("/threads/923066?page=2&returnTo=%2Fforums%2F306%2F3")),
		).toEqual({ destination: "/threads/923066/2?returnTo=%2Fforums%2F306%2F3" });
	});

	it("rejects off-site returnTo (e.g. /admin/...)", () => {
		expect(
			resolveLegacyDiscuzRedirect(u("/threads/923066?page=2&returnTo=%2Fadmin%2Fusers")),
		).toEqual({ destination: "/threads/923066/2" });
	});

	it("rejects absolute / scheme returnTo", () => {
		expect(
			resolveLegacyDiscuzRedirect(u("/threads/923066?page=2&returnTo=https%3A%2F%2Fevil.com%2Fx")),
		).toEqual({ destination: "/threads/923066/2" });
	});

	it("rejects /forums/:id/1 returnTo (page=1 is not canonical with segment)", () => {
		expect(
			resolveLegacyDiscuzRedirect(u("/threads/923066?page=2&returnTo=%2Fforums%2F306%2F1")),
		).toEqual({ destination: "/threads/923066/2" });
	});

	it("rejects returnTo with embedded query / fragment", () => {
		expect(
			resolveLegacyDiscuzRedirect(u("/threads/923066?page=2&returnTo=%2Fforums%2F306%3Fa%3D1")),
		).toEqual({ destination: "/threads/923066/2" });
		expect(
			resolveLegacyDiscuzRedirect(u("/threads/923066?page=2&returnTo=%2Fforums%2F306%23top")),
		).toEqual({ destination: "/threads/923066/2" });
	});

	it("rejects returnTo with extra path segments (e.g. /forums/306/2/extra)", () => {
		expect(
			resolveLegacyDiscuzRedirect(u("/threads/923066?page=2&returnTo=%2Fforums%2F306%2F2%2Fextra")),
		).toEqual({ destination: "/threads/923066/2" });
	});

	it("rejects returnTo with empty path segments (e.g. /forums//)", () => {
		expect(
			resolveLegacyDiscuzRedirect(u("/threads/923066?page=2&returnTo=%2Fforums%2F%2F")),
		).toEqual({ destination: "/threads/923066/2" });
	});

	it("drops cursor / direction / last / unknown keys", () => {
		expect(
			resolveLegacyDiscuzRedirect(
				u("/threads/923066?page=2&cursor=deadbeef&direction=next&last=1&evil=1"),
			),
		).toEqual({ destination: "/threads/923066/2" });
	});
});

describe("resolveLegacyDiscuzRedirect — G: /forums/:fid/1 → bare", () => {
	it("page=1 segment → bare /forums/:fid", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/306/1"))).toEqual({
			destination: "/forums/306",
		});
	});

	it("page >= 2 segment falls through (canonical, alias renders)", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/306/2"))).toBeNull();
		expect(resolveLegacyDiscuzRedirect(u("/forums/306/10"))).toBeNull();
	});

	it("non-numeric segment falls through (alias notFound()s)", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/306/abc"))).toBeNull();
	});

	it("leading-zero segment does not match", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/306/01"))).toBeNull();
	});

	it("preserves typeId when 301-ing /:id/1 → bare", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/306/1?typeId=11"))).toEqual({
			destination: "/forums/306?typeId=11",
		});
	});

	it("drops non-allowlisted query (page=1 path canonical, evil/mobile dropped)", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/306/1?evil=x&mobile=2&fromuid=99"))).toEqual({
			destination: "/forums/306",
		});
	});

	it("drops malformed typeId on /:id/1 → bare", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/306/1?typeId=0"))).toEqual({
			destination: "/forums/306",
		});
	});
});

describe("resolveLegacyDiscuzRedirect — H: /threads/:tid/1 → bare", () => {
	it("page=1 segment → bare /threads/:tid", () => {
		expect(resolveLegacyDiscuzRedirect(u("/threads/923066/1"))).toEqual({
			destination: "/threads/923066",
		});
	});

	it("page >= 2 segment falls through", () => {
		expect(resolveLegacyDiscuzRedirect(u("/threads/923066/2"))).toBeNull();
	});

	it("preserves canonical returnTo when 301-ing /:id/1 → bare", () => {
		expect(resolveLegacyDiscuzRedirect(u("/threads/923066/1?returnTo=%2Fforums%2F306"))).toEqual({
			destination: "/threads/923066?returnTo=%2Fforums%2F306",
		});
	});

	it("rejects off-site returnTo on /:id/1 → bare", () => {
		expect(resolveLegacyDiscuzRedirect(u("/threads/923066/1?returnTo=%2Fadmin%2Fusers"))).toEqual({
			destination: "/threads/923066",
		});
	});

	it("drops cursor / direction / last on /:id/1 → bare", () => {
		expect(
			resolveLegacyDiscuzRedirect(u("/threads/923066/1?cursor=abc&direction=next&last=1&evil=1")),
		).toEqual({ destination: "/threads/923066" });
	});
});

describe("resolveLegacyDiscuzRedirect — defensive id validation", () => {
	it("E: /forums/0?page=2 (zero fid) returns null", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/0?page=2"))).toBeNull();
	});
	it("E: /forums/012?page=2 (leading-zero fid) returns null", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/012?page=2"))).toBeNull();
	});
	it("F: /threads/0?page=2 (zero tid) returns null", () => {
		expect(resolveLegacyDiscuzRedirect(u("/threads/0?page=2"))).toBeNull();
	});
	it("F: /threads/012?page=2 (leading-zero tid) returns null", () => {
		expect(resolveLegacyDiscuzRedirect(u("/threads/012?page=2"))).toBeNull();
	});
	it("G: /forums/0/1 (zero fid) returns null", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/0/1"))).toBeNull();
	});
	it("G: /forums/012/1 (leading-zero fid) returns null", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forums/012/1"))).toBeNull();
	});
	it("H: /threads/0/1 (zero tid) returns null", () => {
		expect(resolveLegacyDiscuzRedirect(u("/threads/0/1"))).toBeNull();
	});
	it("H: /threads/012/1 (leading-zero tid) returns null", () => {
		expect(resolveLegacyDiscuzRedirect(u("/threads/012/1"))).toBeNull();
	});
});

describe("resolveLegacyDiscuzRedirect — non-matching paths", () => {
	it("home / unrelated paths return null", () => {
		expect(resolveLegacyDiscuzRedirect(u("/"))).toBeNull();
		expect(resolveLegacyDiscuzRedirect(u("/login"))).toBeNull();
		expect(resolveLegacyDiscuzRedirect(u("/users/123"))).toBeNull();
		expect(resolveLegacyDiscuzRedirect(u("/threads/new"))).toBeNull();
	});

	it("forum.php with unknown mod returns null", () => {
		expect(resolveLegacyDiscuzRedirect(u("/forum.php"))).toBeNull();
		expect(resolveLegacyDiscuzRedirect(u("/forum.php?mod=portal"))).toBeNull();
	});

	it("/threads/:tid/:page with non-1 segment is canonical (null, no redirect)", () => {
		// The alias route renders these in place.
		expect(resolveLegacyDiscuzRedirect(u("/threads/923066/3"))).toBeNull();
		expect(resolveLegacyDiscuzRedirect(u("/forums/306/4"))).toBeNull();
	});
});
