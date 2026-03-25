/**
 * Avatar path calculator.
 *
 * Per docs/02-database-schema.md users field mapping:
 * Avatar path = data/avatar/{uid%16}/{uid%256}/{uid}_avatar_big.jpg
 *
 * Only calculated when avatarstatus=1.
 */

/**
 * Calculate the Discuz avatar file path from a user ID.
 *
 * DZ stores avatars in a hash-bucketed directory structure:
 *   data/avatar/{uid % 16 (hex)}/{uid % 256 (hex)}/{uid}_avatar_big.jpg
 *
 * The hex values use two-digit zero-padded format.
 *
 * @param uid - The user ID
 * @returns Relative path to the avatar file (DZ format)
 */
export function computeAvatarPath(uid: number): string {
	const bucket1 = (uid % 16).toString(16).padStart(2, "0");
	const bucket2 = (uid % 256).toString(16).padStart(2, "0");
	return `data/avatar/${bucket1}/${bucket2}/${uid}_avatar_big.jpg`;
}

/**
 * Compute the R2 object key for a user avatar.
 *
 * @param uid - The user ID
 * @returns R2 object key (avatars/ prefix for R2 organization)
 */
export function computeAvatarR2Key(uid: number): string {
	return `avatars/${uid}.jpg`;
}

/**
 * Get the avatar value for a user based on their avatarstatus.
 *
 * @param uid - The user ID
 * @param avatarstatus - 0=no avatar, 1=has avatar
 * @returns Empty string if no avatar, R2 key if has avatar
 */
export function getAvatarValue(uid: number, avatarstatus: number): string {
	if (avatarstatus !== 1) return "";
	return computeAvatarR2Key(uid);
}
