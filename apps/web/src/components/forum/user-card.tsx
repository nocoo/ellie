// components/forum/user-card.tsx — User avatar card
// Ref: 04f §8 — default vertical + inline variant

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { User } from "@ellie/types";

interface UserCardProps {
	user: User | null;
	/** "block" = centered column (profile header), "inline" = compact row */
	layout?: "block" | "inline";
}

function authorInitials(name: string): string {
	return name.slice(0, 2).toUpperCase();
}

export function UserCard({ user, layout = "block" }: UserCardProps) {
	if (!user) {
		return (
			<div className="flex items-center gap-2">
				<Avatar className="h-6 w-6">
					<AvatarFallback className="text-[10px]">?</AvatarFallback>
				</Avatar>
				<span className="text-xs text-muted-foreground">未知用户</span>
			</div>
		);
	}

	if (layout === "inline") {
		return (
			<div className="flex items-center gap-2">
				<Avatar className="h-6 w-6">
					<AvatarFallback className="text-[10px]">{authorInitials(user.username)}</AvatarFallback>
				</Avatar>
				<span className="text-sm font-medium text-foreground">{user.username}</span>
				<span className="text-[10px] text-muted-foreground">
					帖子 {user.posts.toLocaleString()}
				</span>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center gap-2">
			<Avatar className="h-12 w-12">
				<AvatarFallback className="text-xs">{authorInitials(user.username)}</AvatarFallback>
			</Avatar>
			<span className="text-xs font-medium text-foreground">{user.username}</span>
			<span className="text-[10px] text-muted-foreground">帖子 {user.posts.toLocaleString()}</span>
		</div>
	);
}
