// Avatar upload limits and URLs for the forum.

export const AVATAR_MAX_UPLOAD_MB = 5;
export const AVATAR_ALLOWED_TYPES = ["image/jpeg", "image/png"];

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

	// The stable marker bypasses old, week-long cached UID responses.
	// The mutable proxy URL now revalidates; GUID URLs above remain cacheable.
	return `/api/avatar/${uid}?v=${cacheBust ?? "current"}`;
}
