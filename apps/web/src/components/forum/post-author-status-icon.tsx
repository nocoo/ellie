// PostAuthorStatusIcon — Discuz classic role / 楼主 indicator shown to the
// left of "发表于 …" in the post meta bar (both desktop and mobile).
//
// Pure-presentational wrapper around `getPostAuthorIconName` + CDN base.
// Keeping desktop and mobile on a single component prevents the two surfaces
// from drifting on the role→icon mapping.

import { getStaticImageUrl } from "@/lib/cdn";
import {
	type PostAuthorIconInput,
	getPostAuthorIconAlt,
	getPostAuthorIconName,
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
	return (
		<img
			src={getStaticImageUrl(name)}
			alt={alt}
			title={alt}
			className={className ?? "h-4 w-4 shrink-0"}
		/>
	);
}
