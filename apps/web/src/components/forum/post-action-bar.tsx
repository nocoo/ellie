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
"use client";

import { Award, Coins, Flag, MessageCircle, Pencil, Reply, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { ForumActionButton } from "./forum-action-button";
import { useForumToast } from "./forum-toast";

interface PostActionBarProps {
	onReply?: () => void | Promise<void>;
	onComment?: () => void | Promise<void>;
	onRateCoins?: () => void | Promise<void>;
	onRateCredits?: () => void | Promise<void>;
	onEdit?: () => void | Promise<void>;
	onDelete?: () => void | Promise<void>;
	onReport?: () => void | Promise<void>;
	canEdit?: boolean;
	canDelete?: boolean;
	canReport?: boolean;
	canComment?: boolean;
	canRateCoins?: boolean;
	canRateCredits?: boolean;
}

function useGuardedAction(action?: () => void | Promise<void>) {
	const toast = useForumToast();
	const busyRef = useRef(false);
	const [busy, setBusy] = useState(false);
	const onClick = async () => {
		if (!action || busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		try {
			await action();
		} catch (error) {
			toast.error({
				title: "操作失败",
				description: error instanceof Error ? error.message : "请稍后重试",
			});
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	};
	return { busy, onClick: action ? onClick : undefined };
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
	const reply = useGuardedAction(onReply);
	const comment = useGuardedAction(onComment);
	const rateCoins = useGuardedAction(onRateCoins);
	const rateCredits = useGuardedAction(onRateCredits);
	const edit = useGuardedAction(onEdit);
	const remove = useGuardedAction(onDelete);
	const report = useGuardedAction(onReport);
	const hasModActions = canEdit || canDelete || canReport;

	return (
		<div className="flex flex-wrap items-center justify-between gap-1 border-t border-border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
			<div className="flex flex-wrap items-center gap-1">
				{canComment && (
					<ForumActionButton
						icon={MessageCircle}
						label="点评"
						onClick={comment.onClick}
						busy={comment.busy}
					/>
				)}
				<ForumActionButton icon={Reply} label="回复" onClick={reply.onClick} busy={reply.busy} />
				{canRateCoins && (
					<ForumActionButton
						icon={Coins}
						label="同钱"
						onClick={rateCoins.onClick}
						busy={rateCoins.busy}
					/>
				)}
				{canRateCredits && (
					<ForumActionButton
						icon={Award}
						label="积分"
						onClick={rateCredits.onClick}
						busy={rateCredits.busy}
					/>
				)}
			</div>

			{hasModActions && (
				<div className="flex flex-wrap items-center gap-1">
					{canEdit && (
						<ForumActionButton icon={Pencil} label="编辑" onClick={edit.onClick} busy={edit.busy} />
					)}
					{canDelete && (
						<ForumActionButton
							icon={Trash2}
							label="删除"
							onClick={remove.onClick}
							busy={remove.busy}
							variant="destructive"
						/>
					)}
					{canReport && (
						<ForumActionButton
							icon={Flag}
							label="举报"
							onClick={report.onClick}
							busy={report.busy}
						/>
					)}
				</div>
			)}
		</div>
	);
}
