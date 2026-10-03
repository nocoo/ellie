"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@nocoo/basalt";
import { useState } from "react";
import { FALLBACK_AVATAR_URL, getUserAvatarUrl } from "@/lib/cdn";

interface UserAvatarProps {
	/** Username, used as `alt` text for accessibility. */
	username: string;
	avatarPath: string;
	/**
	 * Pixel size; sets both width and height inline. Omit to control sizing
	 * entirely through `className` (e.g. responsive utilities like
	 * `h-12 w-12 md:h-16 md:w-16`).
	 */
	size?: number;
	/** Extra Tailwind classes (rounding/shadow/responsive sizing/etc.). */
	className?: string;
}

export function UserAvatar({ username, avatarPath, size, className }: UserAvatarProps) {
	const src = getUserAvatarUrl(avatarPath);
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
			<AvatarFallback>
				<img src={FALLBACK_AVATAR_URL} alt="" className="h-full w-full object-cover" />
			</AvatarFallback>
		</Avatar>
	);
}
