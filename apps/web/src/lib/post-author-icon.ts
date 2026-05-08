// Map a post author's role + thread-author relationship to the Discuz-classic
// status icon shown to the left of "发表于 …" in the post meta bar.
//
// Asset filenames live under static/image/common on the CDN. Use
// `getStaticImageUrl(getPostAuthorIconName(...))` to resolve the full URL.
//
// Priority: thread-author (ico_lz.png) > role badge. Anonymous / missing
// author falls back to the普通会员 icon.

import { UserRole } from "@ellie/types";

export const POST_AUTHOR_ICON = {
	threadAuthor: "ico_lz.png",
	admin: "online_admin.gif",
	superMod: "online_supermod.gif",
	mod: "online_moderator.gif",
	member: "online_member.gif",
} as const;

export type PostAuthorIconName = (typeof POST_AUTHOR_ICON)[keyof typeof POST_AUTHOR_ICON];

export interface PostAuthorIconInput {
	/** UserRole of the post author. `undefined` is treated as普通会员. */
	role?: UserRole | number;
	/** True when the post author is the original thread starter. */
	isThreadAuthor: boolean;
}

/**
 * Resolve the icon filename for the meta bar. Thread-author flag wins over
 * role; unknown role values fall through to the普通会员 default so DZ extended
 * values (-1, 7) don't blow up.
 */
export function getPostAuthorIconName({
	role,
	isThreadAuthor,
}: PostAuthorIconInput): PostAuthorIconName {
	if (isThreadAuthor) return POST_AUTHOR_ICON.threadAuthor;
	switch (role) {
		case UserRole.Admin:
			return POST_AUTHOR_ICON.admin;
		case UserRole.SuperMod:
			return POST_AUTHOR_ICON.superMod;
		case UserRole.Mod:
			return POST_AUTHOR_ICON.mod;
		default:
			return POST_AUTHOR_ICON.member;
	}
}

/**
 * Human-readable alt text for accessibility / fallback rendering.
 */
export function getPostAuthorIconAlt(name: PostAuthorIconName): string {
	switch (name) {
		case POST_AUTHOR_ICON.threadAuthor:
			return "楼主";
		case POST_AUTHOR_ICON.admin:
			return "管理员";
		case POST_AUTHOR_ICON.superMod:
			return "超级版主";
		case POST_AUTHOR_ICON.mod:
			return "版主";
		default:
			return "会员";
	}
}
