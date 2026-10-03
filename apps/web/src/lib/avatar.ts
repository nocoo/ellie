export const AVATAR_MAX_UPLOAD_MB = 5;
export const AVATAR_ALLOWED_TYPES = ["image/jpeg", "image/png"];
export const FALLBACK_URL = "/default-avatar.gif";

export function getAvatarUrl(avatarPath: string): string {
	if (typeof avatarPath !== "string") throw new TypeError("Avatar path is required");
	return avatarPath === "" ? FALLBACK_URL : `https://t.no.mt/${avatarPath}`;
}
