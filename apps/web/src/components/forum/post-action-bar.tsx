// components/forum/post-action-bar.tsx — Simplified post-level action footer
// Only three actions: Reply, Edit, Delete

import type { LucideIcon } from "lucide-react";
import { Pencil, Reply, Trash2 } from "lucide-react";

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
	canEdit?: boolean;
	canDelete?: boolean;
}

export function PostActionBar({
	onReply,
	onEdit,
	onDelete,
	canEdit,
	canDelete,
}: PostActionBarProps) {
	return (
		<div className="flex items-center border-t border-dashed border-border px-3 py-2 text-xs text-forum-text-muted">
			{/* Left action buttons */}
			<div className="flex items-center gap-4">
				<ActionBtn icon={Reply} label="回复" onClick={onReply} />
				{canEdit && <ActionBtn icon={Pencil} label="编辑" onClick={onEdit} />}
				{canDelete && (
					<ActionBtn icon={Trash2} label="删除" onClick={onDelete} variant="destructive" />
				)}
			</div>
		</div>
	);
}
