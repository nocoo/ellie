import { expect, it } from "vitest";
import { parseThreadLocation, threadLocationFromUrl } from "@/lib/thread-location";

const location = (path: string) => threadLocationFromUrl(new URL(path, "https://forum.test"));
it("normalizes thread routes and makes the canonical page authoritative", () => {
	expect(parseThreadLocation(location("/threads/004/3?cursor=bad&last=1&page=9"))).toEqual({
		threadId: 4,
		page: "3",
		cursor: undefined,
		last: undefined,
	});
	expect(
		parseThreadLocation(location("/threads/4?cursor=abc&last=1&page=2&returnTo=/forums/7")),
	).toEqual({ threadId: 4, cursor: "abc", last: "1", page: "2" });
	expect(location("/threads/4?page=2&page=3")).toBe("4?");
	expect(parseThreadLocation(location("/threads/4"))?.threadId).toBe(4);
});

it.each([
	"/",
	"/threads/new",
	"/threads/0",
	"/threads/4/0",
	"/threads/4/01",
	"/threads/4.svg",
	"/threads/999999999999999999",
	"/threads/4/999999999999999999",
	`/threads/4?cursor=${"x".repeat(1100)}`,
])("does not admit invalid or unrelated route %s", (path) => {
	expect(location(path)).toBeNull();
});

it.each([
	null,
	"",
	"0?",
	"1??",
	"1?unknown=1",
	"1?page=1&page=2",
	"99999999999999999?",
	`1?${"x".repeat(1100)}`,
])("rejects an invalid hint %s", (hint) => {
	expect(parseThreadLocation(hint)).toBeNull();
});
