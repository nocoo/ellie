export type BotClass = "bot_search" | "bot_other" | "human" | "unknown";

const SEARCH_BOT_TOKENS = [
	"googlebot",
	"bingbot",
	"baiduspider",
	"yandexbot",
	"duckduckbot",
	"sogou",
	"360spider",
	"haosouspider",
	"yisouspider",
	"applebot",
	"petalbot",
] as const;

const GENERIC_BOT_TOKENS = [
	"bot",
	"spider",
	"crawler",
	"slurp",
	"facebookexternalhit",
	"curl/",
	"wget/",
	"python-requests",
	"libwww",
	"httpclient",
	"go-http-client",
	"headlesschrome",
	"phantomjs",
] as const;

/** Login-audit bucket. Search signatures win over the generic bot tokens. */
export function parseBotClass(userAgent: string | null | undefined): BotClass {
	if (!userAgent) return "unknown";
	const ua = userAgent.toLowerCase();
	if (!ua.trim()) return "unknown";
	for (const token of SEARCH_BOT_TOKENS) {
		if (ua.includes(token)) return "bot_search";
	}
	for (const token of GENERIC_BOT_TOKENS) {
		if (ua.includes(token)) return "bot_other";
	}
	return "human";
}
