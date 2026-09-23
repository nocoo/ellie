import { describe, expect, it } from "vitest";
import { parseBotClass } from "../../../../src/lib/analytics/bot-class";

describe("parseBotClass", () => {
	it("returns unknown for empty agents and classifies search before generic bots", () => {
		expect(parseBotClass(null)).toBe("unknown");
		expect(parseBotClass(undefined)).toBe("unknown");
		expect(parseBotClass("   ")).toBe("unknown");
		expect(parseBotClass("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe("bot_search");
		expect(parseBotClass("curl/8.0")).toBe("bot_other");
		expect(parseBotClass("Mozilla/5.0 (Macintosh)")).toBe("human");
	});
});
