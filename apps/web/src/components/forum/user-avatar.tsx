// components/forum/user-avatar.tsx — Avatar with tavatar.gif fallback
// Renders <img> when src loads successfully, falls back to the classic
// Discuz tavatar.gif on error (e.g. user has no avatar → CDN returns 404).

"use client";

import { getStaticImageUrl } from "@/lib/cdn";
import { type SyntheticEvent, useCallback, useState } from "react";

const TAVATAR_SRC = getStaticImageUrl("tavatar.gif");

interface UserAvatarProps {
	src: string;
	alt: string;
	className?: string;
}

export function UserAvatar({ src, alt, className }: UserAvatarProps) {
	const [failed, setFailed] = useState(false);

	const handleError = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
		if (e.currentTarget.src !== TAVATAR_SRC) {
			e.currentTarget.src = TAVATAR_SRC;
		} else {
			setFailed(true);
		}
	}, []);

	if (failed) {
		return (
			<div className={`flex items-center justify-center bg-muted ${className ?? ""}`}>
				<span className="text-forum-text-muted text-xs">?</span>
			</div>
		);
	}

	return <img src={src} alt={alt} className={className} loading="lazy" onError={handleError} />;
}
