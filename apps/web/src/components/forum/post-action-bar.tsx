// components/forum/post-action-bar.tsx — Simplified post-level action footer
// Layout: User actions (left) | Mod/Author actions (right)
// Per doc 11-frontend-moderation.md §2.1

import type { LucideIcon } from "lucide-react";
import { Flag, Pencil, Reply, Trash2 } from "lucide-react";

interface ActionBtnProps {
	icon: LucideIcon;
	label: string;
	onClick?: () => void;
	variant?: "default" | "destructive";
}

function ActionBtn({ icon: Icon, label, onClick, variant = "default" }: ActionBtnProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex items-center gap-0.5 transition-colors cursor-pointer ${
				variant === "destructive"
					? "text-destructive/70 hover:text-destructive"
					: "text-forum-text-muted hover:text-forum-link"
			}`}
		>
			<Icon className="h-3.5 w-3.5" />
			<span>{label}</span>
		</button>
	);
}

interface PostActionBarProps {
	onReply?: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
	onReport?: () => void;
	canEdit?: boolean;
	canDelete?: boolean;
	canReport?: boolean;
}

export function PostActionBar({
	onReply,
	onEdit,
	onDelete,
	onReport,
	canEdit,
	canDelete,
	canReport,
}: PostActionBarProps) {
	const hasModActions = canEdit || canDelete || canReport;

	return (
		<div className="flex items-center justify-between border-t border-dashed border-border px-3 py-2 text-xs text-forum-text-muted">
			{/* Left: User actions */}
			<div className="flex items-center gap-4">
				<ActionBtn icon={Reply} label="回复" onClick={onReply} />
			</div>

			{/* Right: Mod/Author actions + Report */}
			{hasModActions && (
				<div className="flex items-center gap-4">
					{canEdit && <ActionBtn icon={Pencil} label="编辑" onClick={onEdit} />}
					{canDelete && (
						<ActionBtn icon={Trash2} label="删除" onClick={onDelete} variant="destructive" />
					)}
					{canReport && <ActionBtn icon={Flag} label="举报" onClick={onReport} />}
				</div>
			)}
		</div>
	);
}
