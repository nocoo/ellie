// components/forum/post-action-bar.tsx — Simplified post-level action footer
// Layout: User actions (left) | Mod/Author actions (right)
// Per doc 11-frontend-moderation.md §2.1

import { Flag, MessageCircle, Pencil, Reply, Trash2 } from "lucide-react";
import { ForumActionButton } from "./forum-action-button";

interface PostActionBarProps {
	onReply?: () => void;
	onComment?: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
	onReport?: () => void;
	canEdit?: boolean;
	canDelete?: boolean;
	canReport?: boolean;
	canComment?: boolean;
}

export function PostActionBar({
	onReply,
	onComment,
	onEdit,
	onDelete,
	onReport,
	canEdit,
	canDelete,
	canReport,
	canComment,
}: PostActionBarProps) {
	const hasModActions = canEdit || canDelete || canReport;

	return (
		<div className="flex items-center justify-between border-t border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
			{/* Left: User actions */}
			<div className="flex items-center gap-4">
				{canComment && <ForumActionButton icon={MessageCircle} label="点评" onClick={onComment} />}
				<ForumActionButton icon={Reply} label="回复" onClick={onReply} />
			</div>

			{/* Right: Mod/Author actions + Report */}
			{hasModActions && (
				<div className="flex items-center gap-4">
					{canEdit && <ForumActionButton icon={Pencil} label="编辑" onClick={onEdit} />}
					{canDelete && (
						<ForumActionButton
							icon={Trash2}
							label="删除"
							onClick={onDelete}
							variant="destructive"
						/>
					)}
					{canReport && <ForumActionButton icon={Flag} label="举报" onClick={onReport} />}
				</div>
			)}
		</div>
	);
}
