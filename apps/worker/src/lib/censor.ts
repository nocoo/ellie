// Censor word runtime — checks content against censor_words table
// Used by POST /api/v1/threads (#6) and POST /api/v1/posts (#9)

import type { Env } from "./env";

export interface CensorMatch {
	word: { id: number; find: string; replacement: string; action: string };
	found: string;
}

export interface CensorResult {
	matched: boolean;
	action: "ban" | "replace" | null;
	matches: CensorMatch[];
	filtered: string | null;
}

/**
 * Check content against all censor word rules.
 * Returns the result with matches and filtered content.
 * ban takes priority over replace.
 */
export async function checkCensorWords(content: string, env: Env): Promise<CensorResult> {
	const rows = await env.DB.prepare("SELECT id, find, replacement, action FROM censor_words").all();

	if (!rows.results || rows.results.length === 0) {
		return { matched: false, action: null, matches: [], filtered: null };
	}

	const matches: CensorMatch[] = [];
	let hasBan = false;
	let filtered = content;

	for (const row of rows.results) {
		const r = row as { id: number; find: string; replacement: string; action: string };
		const findStr = r.find;

		let regex: RegExp;
		if (findStr.startsWith("/") && findStr.lastIndexOf("/") > 0) {
			// Regex pattern: /pattern/
			const pattern = findStr.slice(1, findStr.lastIndexOf("/"));
			try {
				regex = new RegExp(pattern, "gi");
			} catch {
				continue; // Skip invalid regex
			}
		} else {
			// Plain text — case insensitive substring
			regex = new RegExp(escapeRegExp(findStr), "gi");
		}

		const match = content.match(regex);
		if (match) {
			matches.push({
				word: { id: r.id, find: r.find, replacement: r.replacement, action: r.action },
				found: match[0],
			});

			if (r.action === "ban") {
				hasBan = true;
			} else if (r.action === "replace") {
				filtered = filtered.replace(regex, r.replacement);
			}
		}
	}

	if (matches.length === 0) {
		return { matched: false, action: null, matches: [], filtered: null };
	}

	if (hasBan) {
		return { matched: true, action: "ban", matches, filtered: null };
	}

	return { matched: true, action: "replace", matches, filtered };
}

/**
 * Apply censor word filtering to content.
 * Returns the filtered content, or throws a CONTENT_BANNED error response.
 * Used by thread/post creation handlers.
 */
export async function applyCensorFilter(
	content: string,
	env: Env,
): Promise<{ content: string; banned: boolean }> {
	const result = await checkCensorWords(content, env);

	if (!result.matched) {
		return { content, banned: false };
	}

	if (result.action === "ban") {
		return { content, banned: true };
	}

	// Replace action — return filtered content
	return { content: result.filtered ?? content, banned: false };
}

function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
