"use client";

// components/forum/post-rating-summary.tsx — Per-post rating aggregate row +
// click-trigger popover with full detail list.
//
// Mounting (docs/22 §7.3): between content & action-bar; rendered only when
// `aggregate.total > 0`. Caller (PostCard) handles the zero-state check.
//
// Reviewer guidance (msg=3d726d71): the detail list must be reachable via
// keyboard/focus, not mouse-hover only. We use base-ui `Popover` (radix-style
// click+keyboard trigger) instead of a CSS hover popover.

import type { PostRatingAggregate, PostRatingRow, PostRatingsResponse } from "@ellie/types";
import { Award, ChevronDown, Coins, Loader2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useForumToast } from "@/components/forum/forum-toast";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { fetchPostRatings, revokePostRating } from "@/viewmodels/forum/rating-reasons";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";

interface PostRatingSummaryProps {
	postId: number;
	/** Initial aggregate from SSR enrichment (always present, may be zero). */
	aggregate: PostRatingAggregate;
}

interface DetailState {
	loading: boolean;
	error: string | null;
	items: PostRatingRow[];
	/**
	 * Aggregate fetched from the detail endpoint — replaces SSR aggregate so
	 * revoke updates reflect immediately without a full page reload.
	 */
	freshAggregate: PostRatingAggregate | null;
}

/**
 * Duck-typed ApiError shape — see post-rating-dialog.tsx for the rationale.
 * Both files share the same vitest isolate:false collision risk against
 * `@/viewmodels/forum/rating-reasons` mock factories.
 */
function isApiErrorLike(err: unknown): err is { code?: string; message: string; status?: number } {
	return (
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		"message" in err &&
		typeof (err as { message: unknown }).message === "string"
	);
}

/**
 * Map ApiError code for revoke calls. Worker returns 404 when the row was
 * already revoked; everything else falls through to the default copy.
 */
function mapRevokeError(err: unknown): string {
	if (!isApiErrorLike(err)) return "网络错误，请重试";
	switch (err.code) {
		case "NOT_FOUND":
		case "RATING_NOT_FOUND":
			return "该评分已被撤销或不存在";
		case "FORBIDDEN":
		case "RATING_REVOKE_PERMISSION_DENIED":
			return "您没有撤销权限";
		default:
			return err.message || "撤销失败，请重试";
	}
}

export function PostRatingSummary({ postId, aggregate }: PostRatingSummaryProps) {
	const toast = useForumToast();
	const [open, setOpen] = useState(false);
	const [detail, setDetail] = useState<DetailState>({
		loading: false,
		error: null,
		items: [],
		freshAggregate: null,
	});
	const [revokingId, setRevokingId] = useState<number | null>(null);
	const [revokeError, setRevokeError] = useState<string | null>(null);
	const loadingRef = useRef(false);
	const revokingRef = useRef<number | null>(null);

	const effective = detail.freshAggregate ?? aggregate;

	const loadDetail = useCallback(async () => {
		if (loadingRef.current) return;
		loadingRef.current = true;
		setDetail((prev) => ({ ...prev, loading: true, error: null }));
		try {
			const response: PostRatingsResponse = await fetchPostRatings(postId);
			setDetail({
				loading: false,
				error: null,
				items: response.items,
				freshAggregate: response.aggregate,
			});
		} catch (err) {
			const message = isApiErrorLike(err) ? err.message : "加载失败";
			setDetail((prev) => ({ ...prev, loading: false, error: message }));
			toast.error({ title: "评分明细加载失败", description: message });
		} finally {
			loadingRef.current = false;
		}
	}, [postId, toast]);

	// Trigger lazy-fetch the first time the popover opens. Re-opens reuse the
	// cached list unless the user explicitly clicks 刷新 (not yet wired —
	// revoke handles its own optimistic update path).
	const handleOpenChange = useCallback(
		(next: boolean) => {
			if (!next && revokingRef.current !== null) return;
			setOpen(next);
			if (next && detail.items.length === 0 && !loadingRef.current && !detail.error) {
				void loadDetail();
			}
		},
		[detail.items.length, detail.error, loadDetail],
	);

	const handleRevoke = useCallback(
		async (row: PostRatingRow) => {
			if (revokingRef.current !== null) return;
			revokingRef.current = row.id;
			setRevokeError(null);
			setRevokingId(row.id);
			try {
				await revokePostRating(postId, row.id);
				toast.success("评分已撤销");
				// Optimistic remove + aggregate adjustment; a follow-up fetch
				// from the popover would also work but the local update is
				// cheap and keeps the row count consistent without a flicker.
				setDetail((prev) => {
					const items = prev.items.filter((r) => r.id !== row.id);
					const base = prev.freshAggregate ?? aggregate;
					const adjusted: PostRatingAggregate = {
						total: Math.max(0, base.total - 1),
						credits: {
							count:
								row.dimension === "credits"
									? Math.max(0, base.credits.count - 1)
									: base.credits.count,
							sum: row.dimension === "credits" ? base.credits.sum - row.score : base.credits.sum,
						},
						coins: {
							count:
								row.dimension === "coins" ? Math.max(0, base.coins.count - 1) : base.coins.count,
							sum: row.dimension === "coins" ? base.coins.sum - row.score : base.coins.sum,
						},
					};
					return { ...prev, items, freshAggregate: adjusted };
				});
			} catch (err) {
				const message = mapRevokeError(err);
				setRevokeError(message);
				toast.error({ title: "撤销失败", description: message });
			} finally {
				revokingRef.current = null;
				setRevokingId(null);
			}
		},
		[postId, toast, aggregate],
	);

	// Caller (PostCard) is supposed to gate this, but defend in depth — never
	// render an empty row.
	if (effective.total === 0) return null;

	return (
		<div
			className="border-t border-dashed border-border px-3 py-2 flex items-center gap-3 flex-wrap text-xs text-muted-foreground"
			data-testid="post-rating-summary"
		>
			<span className="font-medium text-foreground">
				评分 · <span data-testid="post-rating-summary-total">{effective.total}</span> 人参与
			</span>
			{effective.credits.count > 0 && (
				<span className="inline-flex items-center gap-1" data-testid="post-rating-summary-credits">
					<Award className="h-3.5 w-3.5" aria-hidden="true" />
					积分 {effective.credits.sum >= 0 ? `+${effective.credits.sum}` : effective.credits.sum}
				</span>
			)}
			{effective.coins.count > 0 && (
				<span className="inline-flex items-center gap-1" data-testid="post-rating-summary-coins">
					<Coins className="h-3.5 w-3.5" aria-hidden="true" />
					同钱 {effective.coins.sum >= 0 ? `+${effective.coins.sum}` : effective.coins.sum}
				</span>
			)}
			<Popover open={open} onOpenChange={handleOpenChange}>
				<PopoverTrigger
					render={
						<button
							type="button"
							className="ml-auto inline-flex items-center gap-0.5 text-primary hover:underline focus-visible:underline focus-visible:outline-none"
							data-testid="post-rating-summary-toggle"
						>
							展开
							<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
						</button>
					}
				/>
				<PopoverContent className="w-80 max-h-96 overflow-auto" align="end" side="top">
					{detail.loading && (
						<div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
							<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
							加载中…
						</div>
					)}
					{detail.error && (
						<div role="alert" className="space-y-2 text-xs text-destructive">
							<p>{detail.error}</p>
							<Button
								variant="outline"
								size="sm"
								onClick={() => void loadDetail()}
								disabled={detail.loading}
							>
								重试
							</Button>
						</div>
					)}
					{revokeError && (
						<p role="alert" className="text-xs text-destructive">
							{revokeError}
						</p>
					)}
					{!detail.loading && !detail.error && detail.items.length === 0 && (
						<div className="text-xs text-muted-foreground">暂无评分明细</div>
					)}
					{!detail.loading && !detail.error && detail.items.length > 0 && (
						<ul className="flex flex-col gap-1" data-testid="post-rating-summary-list">
							{detail.items.map((row) => (
								<li
									key={row.id}
									className="flex items-start gap-2 py-1 border-b border-dashed border-border last:border-0"
								>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-1.5 text-xs">
											<Link
												href={`/users/${row.raterId}`}
												prefetch={false}
												className="text-forum-link hover:underline truncate"
											>
												{row.raterName}
											</Link>
											<span
												className={cn(
													"inline-flex items-center gap-0.5 font-medium",
													row.score >= 0 ? "text-success" : "text-destructive",
												)}
											>
												{row.dimension === "credits" ? (
													<Award className="h-3 w-3" aria-hidden="true" />
												) : (
													<Coins className="h-3 w-3" aria-hidden="true" />
												)}
												{row.dimension === "credits" ? "积分" : "同钱"}{" "}
												{row.score >= 0 ? `+${row.score}` : row.score}
											</span>
										</div>
										{row.reason && (
											<div className="text-xs text-muted-foreground truncate" title={row.reason}>
												「{row.reason}」
											</div>
										)}
										<div className="text-xs text-muted-foreground">
											{formatRelativeTime(row.createdAt)}
										</div>
									</div>
									{row.canRevoke && (
										<Button
											variant="ghost"
											size="sm"
											className="h-7 px-2 shrink-0"
											disabled={revokingId !== null}
											aria-busy={revokingId === row.id}
											onClick={() => void handleRevoke(row)}
											data-testid={`post-rating-summary-revoke-${row.id}`}
										>
											{revokingId === row.id ? (
												<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
											) : (
												<>
													<Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
													<span className="ml-1">撤销</span>
												</>
											)}
										</Button>
									)}
								</li>
							))}
						</ul>
					)}
				</PopoverContent>
			</Popover>
		</div>
	);
}
