// components/forum/post-action-bar.tsx — Discuz classic post-level action footer

import {
	type LucideIcon,
	MessageCircleMore,
	Pencil,
	Reply,
	ThumbsDown,
	ThumbsUp,
} from "lucide-react";

interface ActionBtnProps {
	icon: LucideIcon;
	label: string;
	onClick?: () => void;
}

function ActionBtn({ icon: Icon, label, onClick }: ActionBtnProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex items-center gap-0.5 text-forum-text-muted hover:text-forum-link transition-colors cursor-pointer"
		>
			<Icon className="h-3.5 w-3.5" />
			<span>{label}</span>
		</button>
	);
}

interface PostActionBarProps {
	onReply?: () => void;
	canModerate?: boolean;
	canEdit?: boolean;
}

export function PostActionBar({ onReply, canModerate, canEdit }: PostActionBarProps) {
	return (
		<div className="flex items-center border-t border-dashed border-border px-3 py-2 text-xs text-forum-text-muted">
			{/* Left action buttons */}
			<div className="flex items-center gap-4">
				<ActionBtn icon={MessageCircleMore} label="点评" />
				<ActionBtn icon={Reply} label="回复" onClick={onReply} />
				{canEdit && <ActionBtn icon={Pencil} label="编辑" />}
				<ActionBtn icon={ThumbsUp} label="支持" />
				<ActionBtn icon={ThumbsDown} label="反对" />
			</div>

			{/* Right action links */}
			<div className="ml-auto flex items-center gap-4">
				<span className="hover:text-forum-link transition-colors cursor-pointer">评分</span>
				<span className="hover:text-forum-link transition-colors cursor-pointer">举报</span>
				{canModerate && (
					<span className="hover:text-forum-link transition-colors cursor-pointer">管理</span>
				)}
			</div>
		</div>
	);
}
