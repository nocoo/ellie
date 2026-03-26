// components/forum/user-card.tsx — User info sidebar in post card
// Ref: 04d §UserCard — avatar + username + role + stats

import { UserAvatar } from "@/components/user-avatar";
import type { User } from "@/models/types";
import { UserRole } from "@/models/types";
import Link from "next/link";

export interface UserCardProps {
	user: User | null;
	authorName: string;
	authorId: number;
}

/**
 * Map UserRole enum to display label.
 * Pure function, exported for testing.
 */
export function getRoleLabel(role: UserRole): string {
	switch (role) {
		case UserRole.Admin:
			return "Admin";
		case UserRole.SuperMod:
			return "SuperMod";
		case UserRole.Mod:
			return "Moderator";
		case UserRole.User:
			return "Member";
	}
}

/**
 * Format a Unix timestamp as date string (YYYY-MM-DD).
 * Pure function, exported for testing.
 */
export function formatDate(timestamp: number): string {
	if (timestamp === 0) return "";
	return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export function UserCard({ user, authorName, authorId }: UserCardProps) {
	return (
		<div className="flex w-28 shrink-0 flex-col items-center text-center">
			<Link href={`/users/${authorId}`}>
				<UserAvatar avatar={user?.avatar} username={authorName} size="lg" />
			</Link>
			<Link
				href={`/users/${authorId}`}
				className="mt-1.5 text-sm font-medium hover:text-primary transition-colors"
			>
				{authorName}
			</Link>
			{user && (
				<div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
					<div>{getRoleLabel(user.role)}</div>
					<div>Posts: {user.posts}</div>
					<div>Joined: {formatDate(user.regDate)}</div>
				</div>
			)}
		</div>
	);
}
