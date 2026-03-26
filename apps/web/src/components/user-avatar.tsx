// components/user-avatar.tsx — Forum user avatar with R2 path resolution
// Ref: 04b §共享布局组件 — UserAvatar (R2 path → img)

import { attachmentUrl } from "@/lib/attachment";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

export interface UserAvatarProps {
	/** User's avatar R2 file path, null/undefined for no avatar */
	avatar?: string | null;
	/** Username for fallback initials */
	username: string;
	/** Avatar size */
	size?: "default" | "sm" | "lg";
	className?: string;
}

/**
 * Extract initials from username for avatar fallback.
 * Takes first 2 characters, uppercased.
 */
export function getInitials(username: string): string {
	return username.slice(0, 2).toUpperCase();
}

export function UserAvatar({ avatar, username, size = "default", className }: UserAvatarProps) {
	const src = avatar ? attachmentUrl(avatar) : undefined;

	return (
		<Avatar size={size} className={cn(className)}>
			{src && <AvatarImage src={src} alt={username} />}
			<AvatarFallback>{getInitials(username)}</AvatarFallback>
		</Avatar>
	);
}
