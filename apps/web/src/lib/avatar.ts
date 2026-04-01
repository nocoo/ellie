// Avatar URL helper — proxied through Next.js API to hide CDN and handle fallback

export type AvatarSize = "big" | "middle" | "small";

/**
 * Get the avatar URL for a given UID.
 * Uses the /api/avatar/:uid proxy which handles fallback server-side.
 */
export function getAvatarUrl(uid: number, size: AvatarSize = "big"): string {
	const params = size !== "big" ? `?size=${size}` : "";
	return `/api/avatar/${uid}${params}`;
}
