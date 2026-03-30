// Discuz UCHome/UCenter UID-based avatar path algorithm.
// Avatars are served from CDN — the DB `avatar` field (R2 key) is NOT used.

const AVATAR_CDN_BASE = "https://t.no.mt/avatar";

export type AvatarSize = "big" | "middle" | "small";

/**
 * Compute the CDN avatar URL for a given UID.
 *
 * Algorithm: zero-pad UID to 9 digits, split into AAA/BB/CC/DD segments.
 * Example: UID 12345 -> "000/01/23/45_avatar_big.jpg"
 */
export function getAvatarUrl(uid: number, size: AvatarSize = "big"): string {
	const padded = uid.toString().padStart(9, "0");
	const dir1 = padded.slice(0, 3);
	const dir2 = padded.slice(3, 5);
	const dir3 = padded.slice(5, 7);
	const file = padded.slice(7, 9);
	return `${AVATAR_CDN_BASE}/${dir1}/${dir2}/${dir3}/${file}_avatar_${size}.jpg`;
}
