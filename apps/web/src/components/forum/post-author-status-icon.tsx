// PostAuthorStatusIcon — Discuz classic role / 楼主 indicator shown to the
// left of "发表于 …" in the post meta bar (both desktop and mobile).
//
// Pure-presentational wrapper around `getPostAuthorIconName` + CDN base.
// Keeping desktop and mobile on a single component prevents the two surfaces
// from drifting on the role→icon mapping.

import { Crown, PenLine, Shield, ShieldCheck, UserRound } from "lucide-react";
import {
	getPostAuthorIconAlt,
	getPostAuthorIconName,
	type PostAuthorIconInput,
} from "@/lib/post-author-icon";

interface PostAuthorStatusIconProps extends PostAuthorIconInput {
	className?: string;
}

export function PostAuthorStatusIcon({
	role,
	isThreadAuthor,
	className,
}: PostAuthorStatusIconProps) {
	const name = getPostAuthorIconName({ role, isThreadAuthor });
	const alt = getPostAuthorIconAlt(name);
	const Icon = {
		"ico_lz.png": PenLine,
		"online_admin.gif": Crown,
		"online_supermod.gif": ShieldCheck,
		"online_moderator.gif": Shield,
		"online_member.gif": UserRound,
	}[name];
	return (
		<Icon role="img" aria-label={alt} className={className ?? "h-3.5 w-3.5 shrink-0 text-primary"}>
			<title>{alt}</title>
		</Icon>
	);
}
