"use client";

// Admin UserAvatar — business-level avatar component.
// Renders a user's avatar via direct CDN URL (`avatarPath` GUID-based path
// when present, otherwise the legacy UID-padded path), with an `onError`
// fallback to the default `tavatar.gif`.
//
// Lives in `apps/admin/src/components/admin/` (not `packages/ui`) because it
// encodes domain-specific URL conventions (CDN base, legacy path layout)
// rather than presentational primitives.

import { Avatar, AvatarFallback, AvatarImage } from "@nocoo/basalt";
import { useState } from "react";
import { FALLBACK_AVATAR_URL, getUserAvatarUrl } from "@/lib/cdn";

interface UserAvatarProps {
	/** Numeric user id; required for the legacy CDN fallback path. */
	uid: number;
	/** Username, used as `alt` text for accessibility. */
	username: string;
	/** GUID-based path from the API (`avatars/abc.jpg`), nullable. */
	avatarPath?: string | null;
	/**
	 * Pixel size; sets both width and height inline. Omit to control sizing
	 * entirely through `className` (e.g. responsive utilities like
	 * `h-12 w-12 md:h-16 md:w-16`).
	 */
	size?: number;
	/** Extra Tailwind classes (rounding/shadow/responsive sizing/etc.). */
	className?: string;
}

export function UserAvatar({ uid, username, avatarPath, size, className }: UserAvatarProps) {
	const src = getUserAvatarUrl(uid, avatarPath);
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	const imageSrc = failedSrc === src ? FALLBACK_AVATAR_URL : src;
	const sizeStyle = typeof size === "number" ? { width: size, height: size } : undefined;
	return (
		<Avatar role="img" aria-label={username} className={className} style={sizeStyle}>
			<AvatarImage
				src={imageSrc}
				alt=""
				loading="lazy"
				onLoadingStatusChange={(status) => {
					if (status === "error" && imageSrc !== FALLBACK_AVATAR_URL) setFailedSrc(src);
				}}
			/>
			<AvatarFallback>{username.slice(0, 1) || "?"}</AvatarFallback>
		</Avatar>
	);
}
