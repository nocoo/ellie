"use client";

// components/forum/post-rating-dialog.tsx — Post rating dialog
//
// Scope (docs/22 §7.2):
//   - Dimension toggle, locked to `defaultDimension` when the entry was
//     opened from a dimension-specific action-bar button.
//   - Score quick-button chips per dimension (RATING_SCORE_PRESETS) +
//     custom input clamped by `getRatingPerVoteBounds()`.
//   - Predefined-reason dropdown sourced from RATING_REASONS_BY_DIMENSION.
//   - Reason textarea ≤ RATING_REASON_MAX_LENGTH chars.
//   - notifyAuthor checkbox (default ✔).
//
// The reviewer's standing constraint: permission only decides entry
// visibility and default dimension; Worker is the final gate. So we don't
// pre-validate role here — we let the API surface SELF_RATING /
// PERMISSION_DENIED / EMAIL_NOT_VERIFIED as ApiError codes.

import { useForumToast } from "@/components/forum/forum-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
	ApiError,
	RATING_REASONS_BY_DIMENSION,
	RATING_SCORE_PRESETS,
	submitPostRating,
} from "@/viewmodels/forum/rating-reasons";
import {
	type CreatePostRatingResponse,
	type PostRatingAggregate,
	RATING_REASON_MAX_LENGTH,
	RatingDimension,
	type RatingDimensionKey,
	getRatingPerVoteBounds,
	ratingDimensionToKey,
} from "@ellie/types";
import { Award, Coins } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

// ─── Error code → user copy ───────────────────────────────────────────────────

/** Map Worker error codes to user-facing strings. */
function mapSubmitError(err: unknown): string {
	if (!(err instanceof ApiError)) return "网络错误，请重试";
	switch (err.code) {
		case "RATING_SELF":
		case "SELF_RATING":
			return "不能给自己评分";
		case "RATING_DUPLICATE":
			return "您已经评过这个维度了";
		case "RATING_DAILY_LIMIT":
			return "今日额度已耗尽";
		case "RATING_SCORE_OUT_OF_RANGE":
			return "分值超出允许范围";
		case "RATING_REASON_TOO_LONG":
			return `理由超过 ${RATING_REASON_MAX_LENGTH} 字`;
		case "RATING_PERMISSION_DENIED":
			return "您没有此维度的评分权限";
		case "RATING_INVALID_POST":
			return "无法对该帖子评分";
		case "EMAIL_NOT_VERIFIED":
			return "请先验证邮箱后再评分";
		default:
			return err.message || "提交失败，请重试";
	}
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PostRatingDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	postId: number;
	/** Pre-selected dimension from the action-bar entry. Locks the toggle. */
	defaultDimension: RatingDimension;
	/**
	 * Whether the current user is allowed to rate `credits`. When false the
	 * dimension toggle hides the credits tab and stays on coins. Worker is
	 * still the final permission gate.
	 */
	canRateCredits: boolean;
	/** Called with the fresh aggregate when a rating is successfully created. */
	onSuccess?: (response: CreatePostRatingResponse) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PostRatingDialog({
	open,
	onOpenChange,
	postId,
	defaultDimension,
	canRateCredits,
	onSuccess,
}: PostRatingDialogProps) {
	const toast = useForumToast();
	const reasonInputId = useId();
	const customScoreId = useId();
	const presetReasonId = useId();
	const notifyId = useId();

	const [dimension, setDimension] = useState<RatingDimension>(defaultDimension);
	const [scoreInput, setScoreInput] = useState<string>("");
	const [reason, setReason] = useState<string>("");
	const [notifyAuthor, setNotifyAuthor] = useState<boolean>(true);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Reset every time the dialog opens — keeps state clean across re-entry.
	useEffect(() => {
		if (!open) return;
		const initial = canRateCredits ? defaultDimension : RatingDimension.Coins;
		setDimension(initial);
		setScoreInput("");
		setReason("");
		setNotifyAuthor(true);
		setSubmitting(false);
		setError(null);
	}, [open, defaultDimension, canRateCredits]);

	const dimensionKey: RatingDimensionKey = ratingDimensionToKey(dimension);
	const bounds = useMemo(() => getRatingPerVoteBounds(dimension), [dimension]);
	const presets = RATING_SCORE_PRESETS[dimensionKey];
	const reasons = RATING_REASONS_BY_DIMENSION[dimensionKey];

	// Parse + validate the score input (allow negative, reject zero / NaN).
	const parsedScore = Number.parseInt(scoreInput, 10);
	const scoreValid =
		!Number.isNaN(parsedScore) &&
		parsedScore !== 0 &&
		Math.abs(parsedScore) >= bounds.min &&
		Math.abs(parsedScore) <= bounds.max;

	const reasonTrimmed = reason.trim();
	const reasonValid = reasonTrimmed.length > 0 && reasonTrimmed.length <= RATING_REASON_MAX_LENGTH;

	const canSubmit = !submitting && scoreValid && reasonValid;

	const dimensionMeta = {
		[RatingDimension.Credits]: {
			label: "积分",
			icon: Award,
		},
		[RatingDimension.Coins]: {
			label: "同钱",
			icon: Coins,
		},
	} as const;

	const handleDimensionSwitch = (next: RatingDimension) => {
		if (next === dimension) return;
		// Locked when caller said "credits forbidden". Defensive — the
		// tab itself is disabled in that case, but keep the guard.
		if (next === RatingDimension.Credits && !canRateCredits) return;
		setDimension(next);
		// Score presets differ between dimensions — clear the input so
		// the user re-picks within the new bounds.
		setScoreInput("");
	};

	const handlePresetClick = (n: number) => {
		setScoreInput(String(n));
	};

	const handleReasonPreset = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const value = e.target.value;
		if (value !== "") {
			setReason(value);
		}
	};

	const handleSubmit = async () => {
		if (!canSubmit) return;
		setSubmitting(true);
		setError(null);
		try {
			const response = await submitPostRating(postId, {
				dimension: dimensionKey,
				score: parsedScore,
				reason: reasonTrimmed,
				notifyAuthor,
			});
			toast.success("评分提交成功");
			onSuccess?.(response);
			onOpenChange(false);
		} catch (err) {
			const message = mapSubmitError(err);
			setError(message);
			toast.error({ title: "评分提交失败", description: message });
		} finally {
			setSubmitting(false);
		}
	};

	const ActiveIcon = dimensionMeta[dimension].icon;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<ActiveIcon className="h-5 w-5" />
						评分
					</DialogTitle>
					<DialogDescription>
						评分将给作者{dimensionMeta[dimension].label}，可正可负，撤销后额度自动返还。
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-2">
					{/* Dimension toggle — locked when only one dimension is allowed */}
					<div className="space-y-2">
						<div className="text-sm font-medium">维度</div>
						<div className="inline-flex rounded-lg border border-input p-0.5" role="tablist">
							{([RatingDimension.Coins, RatingDimension.Credits] as const).map((d) => {
								const meta = dimensionMeta[d];
								const Icon = meta.icon;
								const active = d === dimension;
								const disabled = d === RatingDimension.Credits && !canRateCredits;
								return (
									<button
										key={d}
										type="button"
										role="tab"
										aria-selected={active}
										disabled={disabled || submitting}
										onClick={() => handleDimensionSwitch(d)}
										className={cn(
											"flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition-colors",
											active
												? "bg-primary text-primary-foreground"
												: "text-muted-foreground hover:text-foreground",
											disabled && "opacity-50 cursor-not-allowed",
										)}
									>
										<Icon className="h-3.5 w-3.5" />
										{meta.label}
									</button>
								);
							})}
						</div>
					</div>

					{/* Score quick chips + custom input */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<label htmlFor={customScoreId} className="text-sm font-medium">
								分值
							</label>
							<span className="text-xs text-muted-foreground">
								|值| ∈ [{bounds.min}, {bounds.max}]
							</span>
						</div>
						<div className="flex flex-wrap gap-1.5">
							{presets.map((n) => (
								<button
									key={n}
									type="button"
									disabled={submitting}
									onClick={() => handlePresetClick(n)}
									className={cn(
										"px-2.5 py-1 rounded-md border text-sm transition-colors min-w-[3rem]",
										parsedScore === n
											? "border-primary bg-primary/10 text-foreground"
											: "border-border hover:border-primary/50",
									)}
								>
									{n > 0 ? `+${n}` : n}
								</button>
							))}
						</div>
						<Input
							id={customScoreId}
							type="number"
							inputMode="numeric"
							placeholder={`自定义分值，例如 ${bounds.max}`}
							value={scoreInput}
							onChange={(e) => setScoreInput(e.target.value)}
							disabled={submitting}
							aria-invalid={scoreInput !== "" && !scoreValid}
						/>
						{scoreInput !== "" && !scoreValid && (
							<p className="text-xs text-destructive">
								请输入 ±{bounds.min}..±{bounds.max} 范围内的非零整数
							</p>
						)}
					</div>

					{/* Predefined reason dropdown + textarea */}
					<div className="space-y-2">
						<label htmlFor={reasonInputId} className="text-sm font-medium">
							理由
						</label>
						<select
							id={presetReasonId}
							onChange={handleReasonPreset}
							value=""
							disabled={submitting}
							className="h-8 w-full appearance-none rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
							aria-label="选择预设理由"
						>
							<option value="">选择预设理由…</option>
							{reasons.map((r) => (
								<option key={r} value={r}>
									{r}
								</option>
							))}
						</select>
						<Textarea
							id={reasonInputId}
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							placeholder="请输入评分理由（必填，最多 40 字）"
							maxLength={RATING_REASON_MAX_LENGTH}
							rows={2}
							disabled={submitting}
							aria-invalid={reason !== "" && !reasonValid}
						/>
						<p
							className={cn(
								"text-xs",
								reasonTrimmed.length > RATING_REASON_MAX_LENGTH
									? "text-destructive"
									: "text-muted-foreground",
							)}
						>
							{reasonTrimmed.length} / {RATING_REASON_MAX_LENGTH}
						</p>
					</div>

					{/* Notify author */}
					<label htmlFor={notifyId} className="flex items-center gap-2 cursor-pointer">
						<Checkbox
							id={notifyId}
							checked={notifyAuthor}
							onCheckedChange={(v) => setNotifyAuthor(v === true)}
							disabled={submitting}
						/>
						<span className="text-sm">通知作者（发送站内信）</span>
					</label>

					{/* Error display */}
					{error && (
						<div className="rounded-lg bg-destructive/10 text-destructive text-sm p-2.5">
							{error}
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
						取消
					</Button>
					<Button onClick={handleSubmit} disabled={!canSubmit}>
						{submitting ? "提交中…" : "提交评分"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Helper for callers that need to refresh aggregate state after a successful
 * rating. Exported so PostCard / PostRatingSummary can share the shape.
 */
export type RatingDialogSuccessHandler = (
	aggregate: PostRatingAggregate,
	response: CreatePostRatingResponse,
) => void;
