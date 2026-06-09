"use client";

// Admin UserAvatar — business-level avatar component.
// Renders a user's avatar via direct CDN URL (`avatarPath` GUID-based path
// when present, otherwise the legacy UID-padded path), with an `onError`
// fallback to the default `tavatar.gif`.
//
// Lives in `apps/admin/src/components/admin/` (not `packages/ui`) because it
// encodes domain-specific URL conventions (CDN base, legacy path layout)
// rather than presentational primitives.

import { cn } from "@ellie/ui";
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
	const sizeStyle = typeof size === "number" ? { width: size, height: size } : undefined;
	return (
		<img
			src={src}
			alt={username}
			width={size}
			height={size}
			loading="lazy"
			className={cn("rounded-full bg-muted object-cover", className)}
			style={sizeStyle}
			onError={(e) => {
				// Single-shot fallback: only swap once so we never loop if even
				// the fallback fails (e.g. CDN outage).
				const img = e.currentTarget;
				if (img.dataset.fallback === "1") return;
				img.dataset.fallback = "1";
				img.src = FALLBACK_AVATAR_URL;
			}}
		/>
	);
}
