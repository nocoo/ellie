// lib/smiley-map.ts — Smiley code → image path mapping
// Ref: 04e §表情系统 — debug/test only, not used at runtime
// At runtime, migrated content already has <img> tags (Doc03).

/** Smiley packs available in public/smileys/ */
export const SMILEY_PACKS = ["default", "coolmonkey", "soso"] as const;
export type SmileyPack = (typeof SMILEY_PACKS)[number];

/**
 * Maps DZ smiley codes to image paths relative to /smileys/.
 * Based on data/cache/cache_smiley.php from Discuz.
 */
export const SMILEY_MAP: Record<string, string> = {
	// ─── Default pack ───────────────────────────────
	":)": "/smileys/default/smile.gif",
	":(": "/smileys/default/sad.gif",
	":D": "/smileys/default/biggrin.gif",
	":@": "/smileys/default/mad.gif",
	":o": "/smileys/default/shocked.gif",
	":P": "/smileys/default/tongue.gif",
	":$": "/smileys/default/shy.gif",
	";)": "/smileys/default/wink.gif",
	":|": "/smileys/default/sweat.gif",
	":L": "/smileys/default/lol.gif",
	":Q": "/smileys/default/cry.gif",
	":lol": "/smileys/default/lol.gif",
	":hug:": "/smileys/default/hug.gif",
	":victory:": "/smileys/default/victory.gif",
	":time:": "/smileys/default/time.gif",
	":kiss:": "/smileys/default/kiss.gif",
	":handshake": "/smileys/default/handshake.gif",
	":call:": "/smileys/default/call.gif",
	":loveliness:": "/smileys/default/loveliness.gif",

	// ─── Soso pack (QQ-style) ───────────────────────
	"{:soso_e100:}": "/smileys/soso/e100.gif",
	"{:soso_e101:}": "/smileys/soso/e101.gif",
	"{:soso_e102:}": "/smileys/soso/e102.gif",
	"{:soso_e103:}": "/smileys/soso/e103.gif",
	"{:soso_e104:}": "/smileys/soso/e104.gif",
	"{:soso_e105:}": "/smileys/soso/e105.gif",
	"{:soso_e106:}": "/smileys/soso/e106.gif",
	"{:soso_e107:}": "/smileys/soso/e107.gif",
	"{:soso_e108:}": "/smileys/soso/e108.gif",
	"{:soso_e109:}": "/smileys/soso/e109.gif",
	"{:soso_e110:}": "/smileys/soso/e110.gif",
	"{:soso_e111:}": "/smileys/soso/e111.gif",
	"{:soso_e112:}": "/smileys/soso/e112.gif",
	"{:soso_e113:}": "/smileys/soso/e113.gif",

	// ─── Coolmonkey pack ────────────────────────────
	"{:coolmonkey_001:}": "/smileys/coolmonkey/001.gif",
	"{:coolmonkey_002:}": "/smileys/coolmonkey/002.gif",
	"{:coolmonkey_003:}": "/smileys/coolmonkey/003.gif",
	"{:coolmonkey_004:}": "/smileys/coolmonkey/004.gif",
	"{:coolmonkey_005:}": "/smileys/coolmonkey/005.gif",
};

/**
 * Look up a smiley code and return the image path, or null if not found.
 */
export function getSmileyPath(code: string): string | null {
	return SMILEY_MAP[code] ?? null;
}

/**
 * Get all smiley codes for a given pack.
 */
export function getSmileysByPack(pack: SmileyPack): Array<{ code: string; path: string }> {
	const prefix = `/smileys/${pack}/`;
	return Object.entries(SMILEY_MAP)
		.filter(([, path]) => path.startsWith(prefix))
		.map(([code, path]) => ({ code, path }));
}
