"use client";

// components/forum/user-avatar.tsx — Avatar components
// UserAvatar: Simple avatar with src/alt (for general use)
// TrackedUserAvatar: Uses AvatarContext for automatic version tracking (for current user's profile)

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAvatarUrl } from "@/contexts/avatar-context";
import { getAvatarUrl } from "@/lib/avatar";
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

export function TrackedUserAvatar({
	uid,
	username,
	size = "md",
	className,
}: TrackedUserAvatarProps) {
	const avatarUrl = useAvatarUrl(uid);

	return (
		<Avatar
			className={cn(
				sizeClasses[size],
				"rounded-sm after:rounded-sm shadow-[0_0_2px_rgba(0,0,0,0.15)] dark:shadow-[0_0_2px_rgba(255,255,255,0.10)]",
				className,
			)}
		>
			<AvatarImage src={avatarUrl} alt={username ?? `User ${uid}`} className="rounded-sm" />
			<AvatarFallback className="text-sm rounded-sm bg-muted p-0 overflow-hidden">
				<img src={getStaticImageUrl("tavatar.gif")} alt="" className="h-full w-full object-cover" />
			</AvatarFallback>
		</Avatar>
	);
}

// ---------------------------------------------------------------------------
// ForumAvatar — Forum thread/comment avatar with rounded-sm + tavatar fallback
// Encapsulates the repeated Avatar+Image+Fallback pattern from thread-item,
// digest-card, post-comments, etc.
// ---------------------------------------------------------------------------

interface ForumAvatarProps {
	userId: number;
	userName: string;
	avatarPath?: string | null;
	/** Avatar size. "xs" (20px) for comments; "sm" (24px) for thread rows; "md" (32px) for post cards; "lg" (48px) for messages. */
	size?: "xs" | "sm" | "md" | "lg";
	/** Show subtle drop shadow (used in desktop thread rows). */
	shadow?: boolean;
	/** Additional className on the root Avatar element. */
	className?: string;
}

export function ForumAvatar({
	userId,
	userName,
	avatarPath,
	size = "sm",
	shadow = false,
	className,
}: ForumAvatarProps) {
	const sizeClass = size === "xs" ? "h-5 w-5" : size === "lg" ? "h-12 w-12" : undefined;

	return (
		<Avatar
			size={size === "sm" ? "sm" : undefined}
			className={cn(
				"rounded-sm",
				sizeClass,
				shadow && "shadow-[0_0_2px_rgba(0,0,0,0.1)] dark:shadow-[0_0_2px_rgba(255,255,255,0.10)]",
				className,
			)}
		>
			<AvatarImage
				src={getAvatarUrl(userId, "small", avatarPath ?? undefined)}
				alt={userName}
				className="rounded-sm"
			/>
			<AvatarFallback className={cn("rounded-sm bg-muted p-0 overflow-hidden", "text-xs")}>
				<img src={getStaticImageUrl("tavatar.gif")} alt="" className="h-full w-full object-cover" />
			</AvatarFallback>
		</Avatar>
	);
}
