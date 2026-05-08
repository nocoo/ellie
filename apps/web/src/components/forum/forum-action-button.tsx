// components/forum/forum-action-button.tsx — Shared inline action button
// Used in post-action-bar (reply/edit/delete) and thread-mod-menu (sticky/move/etc.)

import type { LucideIcon } from "lucide-react";

interface ForumActionButtonProps {
	icon: LucideIcon;
	label: string;
	onClick?: () => void;
	disabled?: boolean;
	variant?: "default" | "destructive";
}

export function ForumActionButton({
	icon: Icon,
	label,
	onClick,
	disabled,
	variant = "default",
}: ForumActionButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`flex items-center gap-0.5 rounded-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed ${
				variant === "destructive"
					? "text-destructive/70 hover:text-destructive"
					: "text-muted-foreground hover:text-foreground"
			}`}
		>
			<Icon className="h-3.5 w-3.5" />
			<span>{label}</span>
		</button>
	);
}
