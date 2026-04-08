// Avatar URL helper — proxied through Next.js API to hide CDN and handle fallback

export type AvatarSize = "big" | "middle" | "small";

/**
 * Get the avatar URL for a given UID.
 * Uses the /api/avatar/:uid proxy which handles fallback server-side.
 *
 * @param uid - User ID
 * @param size - Deprecated: kept for backward compatibility, now ignored (always serves "big")
 * @param cacheBust - Optional timestamp for cache busting after avatar upload
 * @returns Avatar URL string
 */
export function getAvatarUrl(
	uid: number,
	size: AvatarSize = "big",
	cacheBust?: number,
): string {
	// Size parameter kept for backward compatibility but ignored — always serve big
	const params = cacheBust ? `?v=${cacheBust}` : "";
	return `/api/avatar/${uid}${params}`;
}
