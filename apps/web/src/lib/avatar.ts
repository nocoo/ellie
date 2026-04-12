// Avatar URL helper — proxied through Next.js API to hide CDN and handle fallback

export type AvatarSize = "big" | "middle" | "small";

/** CDN base URL for direct avatar access */
const CDN_BASE = "https://t.no.mt";

/**
 * Get the avatar URL for a given UID.
 *
 * If avatarPath is provided (GUID-based path), returns direct CDN URL.
 * Otherwise, uses the /api/avatar/:uid proxy which handles fallback server-side.
 *
 * @param uid - User ID
 * @param size - Deprecated: kept for backward compatibility, now ignored (always serves "big")
 * @param avatarPath - Optional GUID-based path (e.g., "avatars/abc123.jpg")
 * @param cacheBust - Optional timestamp for cache busting after avatar upload
 * @returns Avatar URL string
 */
export function getAvatarUrl(
	uid: number,
	_size: AvatarSize = "big",
	avatarPath?: string,
	cacheBust?: number,
): string {
	// If avatarPath is set, use direct CDN URL (bypasses proxy)
	if (avatarPath) {
		const params = cacheBust ? `?v=${cacheBust}` : "";
		return `${CDN_BASE}/${avatarPath}${params}`;
	}

	// Fall back to proxy for legacy UID-based paths
	const params = cacheBust ? `?v=${cacheBust}` : "";
	return `/api/avatar/${uid}${params}`;
}
