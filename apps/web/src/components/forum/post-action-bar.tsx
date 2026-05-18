// components/forum/post-action-bar.tsx — Simplified post-level action footer
// Layout: User actions (left) | Mod/Author actions (right)
// Per doc 11-frontend-moderation.md §2.1; rating entries per docs/22 §7.1.
//
// Rating entry buttons live with the other user actions (回复 / 点评):
//   - 同钱 (coins, lucide Coins) — visible whenever the orchestrator says
//     the viewer is non-self, logged in, and the post is rateable.
//   - 积分 (credits, lucide Award) — additionally requires the viewer's
//     role ∈ {Mod, SuperMod, Admin} (per docs/22 §3 permission matrix).
//
// Permission gating is purely UX (decides default dimension + which entry
// to render). Worker still enforces verified-email / `PERMISSION_DENIED`
// / `SELF_RATING` etc. — the dialog must surface those errors verbatim.

import { Award, Coins, Flag, MessageCircle, Pencil, Reply, Trash2 } from "lucide-react";
import { ForumActionButton } from "./forum-action-button";

interface PostActionBarProps {
	onReply?: () => void;
	onComment?: () => void;
	onRateCoins?: () => void;
	onRateCredits?: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
	onReport?: () => void;
	canEdit?: boolean;
	canDelete?: boolean;
	canReport?: boolean;
	canComment?: boolean;
	canRateCoins?: boolean;
	canRateCredits?: boolean;
}

export function PostActionBar({
	onReply,
	onComment,
	onRateCoins,
	onRateCredits,
	onEdit,
	onDelete,
	onReport,
	canEdit,
	canDelete,
	canReport,
	canComment,
	canRateCoins,
	canRateCredits,
}: PostActionBarProps) {
	const hasModActions = canEdit || canDelete || canReport;

	return (
		<div className="flex items-center justify-between border-t border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
			{/* Left: User actions */}
			<div className="flex items-center gap-4">
				{canComment && <ForumActionButton icon={MessageCircle} label="点评" onClick={onComment} />}
				<ForumActionButton icon={Reply} label="回复" onClick={onReply} />
				{canRateCoins && <ForumActionButton icon={Coins} label="同钱" onClick={onRateCoins} />}
				{canRateCredits && <ForumActionButton icon={Award} label="积分" onClick={onRateCredits} />}
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
