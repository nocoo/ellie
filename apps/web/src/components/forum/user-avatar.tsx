// components/forum/user-avatar.tsx — Avatar with lucide icon fallback
// Renders <img> when src loads successfully, falls back to a UserRound
// icon on error (e.g. user has no avatar set → CDN returns 404).

"use client";

import { UserRound } from "lucide-react";
import { type SyntheticEvent, useCallback, useState } from "react";

interface UserAvatarProps {
	src: string;
	alt: string;
	className?: string;
	iconClassName?: string;
}

export function UserAvatar({ src, alt, className, iconClassName }: UserAvatarProps) {
	const [failed, setFailed] = useState(false);

	const handleError = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
		e.currentTarget.style.display = "none";
		setFailed(true);
	}, []);

	if (failed) {
		return (
			<div className={`flex items-center justify-center bg-[#F0F0F0] ${className ?? ""}`}>
				<UserRound className={`text-forum-text-muted ${iconClassName ?? "h-2/3 w-2/3"}`} strokeWidth={1.2} />
			</div>
		);
	}

	return <img src={src} alt={alt} className={className} loading="lazy" onError={handleError} />;
}
