/**
 * scripts/lib/read-dotenv — minimal .env reader for L2/L3 runners.
 *
 * next dev auto-loads `apps/{web,admin}/.env.local`, but the L3 runners spawn
 * `next` in a curated env passed to spawnDetached. Any variable we do NOT
 * copy into that map is invisible to the dev server. Historically we only
 * forwarded `process.env.NEXT_PUBLIC_CAP_API_ENDPOINT`, which CI populates
 * from a repo secret. Locally that variable is only in `.env.local`, so the
 * L3 login form ran fail-closed (empty endpoint → submit permanently
 * disabled → auth.spec 60s timeouts).
 *
 * This helper reads a single key from a dotenv file so the runner can pass
 * the same value the human sees when they `bun run dev`. Kept intentionally
 * dumb: no interpolation, no quoting rules beyond stripping matched quotes,
 * no dependencies.
 */

import { readFileSync } from "node:fs";

/**
 * Read `key` from a `.env` file. Returns "" when the file is unreadable or
 * the key is absent — never throws, since the runner treats missing values
 * as "run without CAPTCHA" rather than a hard failure.
 */
export function readDotenvValue(filePath: string, key: string): string {
	let raw: string;
	try {
		raw = readFileSync(filePath, "utf8");
	} catch {
		return "";
	}
	// Anchor to line start; ignore leading whitespace and optional `export`.
	const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`, "m");
	const match = raw.match(pattern);
	if (!match) return "";
	let value = match[1].trim();
	// Strip surrounding single/double quotes if the whole value is quoted.
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		value = value.slice(1, -1);
	}
	return value;
}
