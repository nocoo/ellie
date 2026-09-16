// components/forum/dialog-hero-header.tsx — Hero-style dialog header used by
// new-thread / reply / post-edit / profile-edit dialogs.
//
// Extracted to consolidate the repeated 10x10 primary tile + title/description
// + close button layout. Scope is intentionally narrow: A-class (hero shell)
// dialogs only. Footer / error / width / height are NOT owned here.

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface DialogHeroHeaderProps {
	/** Pre-sized lucide icon (typically `h-5 w-5 text-primary`) */
	icon: ReactNode;
	title: string;
	description?: ReactNode;
	onClose?: () => void;
	closeDisabled?: boolean;
	className?: string;
}

export function DialogHeroHeader({
	icon,
	title,
	description,
	onClose,
	closeDisabled,
	className,
}: DialogHeroHeaderProps) {
	return (
		<DialogHeader className={cn("border-b border-border px-5 py-4", className)}>
			<div className="flex items-start justify-between gap-3">
				<div className="flex items-center gap-3 min-w-0">
					<div
						className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10"
						aria-hidden="true"
					>
						{icon}
					</div>
					<div className="min-w-0 flex-1">
						<DialogTitle className="text-lg">{title}</DialogTitle>
						{description && (
							<DialogDescription className="mt-1 break-words text-xs leading-5">
								{description}
							</DialogDescription>
						)}
					</div>
				</div>
				{onClose && (
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={onClose}
						disabled={closeDisabled}
						className="text-muted-foreground hover:text-foreground shrink-0"
					>
						<span className="sr-only">关闭</span>
						<X className="h-4 w-4" />
					</Button>
				)}
			</div>
		</DialogHeader>
	);
}
