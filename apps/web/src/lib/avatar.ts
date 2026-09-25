import { computeAvatarCdnPath, FALLBACK_URL } from "./avatar-proxy";

export const AVATAR_MAX_UPLOAD_MB = 5;
export const AVATAR_ALLOWED_TYPES = ["image/jpeg", "image/png"];

export function getAvatarUrl(uid: number, avatarPath?: string | null, cacheBust?: number): string {
	if (!Number.isSafeInteger(uid) || uid <= 0) return FALLBACK_URL;
	if (avatarPath !== undefined) {
		const url = computeAvatarCdnPath(uid, avatarPath ?? "");
		return cacheBust ? `${url}?v=${cacheBust}` : url;
	}
	return `/api/avatar/${uid}?v=${cacheBust ?? "current"}`;
}
