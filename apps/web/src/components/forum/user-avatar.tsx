"use client";

// components/forum/user-avatar.tsx — Avatar components
// UserAvatar: Simple avatar with src/alt (for general use)
// TrackedUserAvatar: Uses AvatarContext for automatic version tracking (for current user's profile)

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAvatarUrl } from "@/contexts/avatar-context";
import { getStaticImageUrl } from "@/lib/cdn";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Simple UserAvatar — basic img component, used in most places
// ---------------------------------------------------------------------------

interface UserAvatarProps {
	src: string;
	alt: string;
	className?: string;
}

export function UserAvatar({ src, alt, className }: UserAvatarProps) {
	return <img src={src} alt={alt} className={className} loading="lazy" />;
}

// ---------------------------------------------------------------------------
// TrackedUserAvatar — Uses context for automatic version updates
// Use this when the avatar needs to update immediately after upload (e.g., profile page)
// ---------------------------------------------------------------------------

interface TrackedUserAvatarProps {
	uid: number;
	username?: string;
	size?: "sm" | "md" | "lg";
	className?: string;
}

const sizeClasses = {
	sm: "h-8 w-8",
	md: "h-10 w-10",
	lg: "h-12 w-12",
};

export function TrackedUserAvatar({ uid, username, size = "md", className }: TrackedUserAvatarProps) {
	const avatarUrl = useAvatarUrl(uid);

	return (
		<Avatar className={cn(sizeClasses[size], "rounded-sm shadow-[0_0_2px_rgba(0,0,0,0.15)]", className)}>
			<AvatarImage
				src={avatarUrl}
				alt={username ?? `User ${uid}`}
				className="rounded-sm"
			/>
			<AvatarFallback className="text-sm rounded-sm bg-muted p-0 overflow-hidden">
				<img
					src={getStaticImageUrl("tavatar.gif")}
					alt=""
					className="h-full w-full object-cover"
				/>
			</AvatarFallback>
		</Avatar>
	);
}
