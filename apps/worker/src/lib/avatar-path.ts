// Avatar path computation — shared between upload handler and avatar proxy
// Generates R2 key path following existing CDN structure at t.no.mt

/**
 * Compute the R2 key path for a user's avatar.
 * Path format: avatar/{dir1}/{dir2}/{dir3}/{file}_avatar_big.jpg
 *
 * Example: UID 12345 → avatar/000/01/23/45_avatar_big.jpg
 *
 * @param uid - User ID
 * @returns R2 key path (without leading slash)
 */
export function computeAvatarPath(uid: number): string {
	const padded = uid.toString().padStart(9, "0");
	const dir1 = padded.slice(0, 3);
	const dir2 = padded.slice(3, 5);
	const dir3 = padded.slice(5, 7);
	const file = padded.slice(7, 9);
	return `avatar/${dir1}/${dir2}/${dir3}/${file}_avatar_big.jpg`;
}
