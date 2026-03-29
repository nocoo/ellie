// components/forum/user-card.tsx — Author info sidebar for post display
// Ref: 04d §UserCard — avatar + username + role + stats

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { User } from "@ellie/types";

interface UserCardProps {
	user: User | null;
}

function authorInitials(name: string): string {
	return name.slice(0, 2).toUpperCase();
}

export function UserCard({ user }: UserCardProps) {
	if (!user) {
		return (
			<div className="flex flex-col items-center gap-2">
				<Avatar className="h-12 w-12">
					<AvatarFallback className="text-xs">?</AvatarFallback>
				</Avatar>
				<span className="text-xs text-muted-foreground">未知用户</span>
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
