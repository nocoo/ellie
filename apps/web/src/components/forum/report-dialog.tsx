"use client";

// components/forum/report-dialog.tsx — Post report dialog with three-step verification

import { CapWidget } from "@/components/cap-widget";
import { useForumToast } from "@/components/forum/forum-toast";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
	ApiError,
	REPORT_REASONS,
	type ReportReason,
	type ReportTargetType,
	submitReport,
} from "@/viewmodels/forum/report";
import { writeGatePreflight } from "@/viewmodels/forum/write-gate";
import { AlertCircle, CheckCircle2, CircleDot, Flag, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const CAP_API_ENDPOINT = process.env.NEXT_PUBLIC_CAP_API_ENDPOINT ?? "";

// Type-aware copy. Keys correspond to ReportTargetType.
const TYPE_COPY: Record<
	ReportTargetType,
	{
		title: string;
		permissionPassed: string;
		duplicate: string;
		cannotSelf: string;
		notFound: string;
	}
> = {
	thread: {
		title: "举报主题",
		permissionPassed: "您有权限举报此主题",
		duplicate: "您已经举报过这个主题了",
		cannotSelf: "不能举报自己的主题",
		notFound: "主题不存在",
	},
	post: {
		title: "举报回帖",
		permissionPassed: "您有权限举报此回复",
		duplicate: "您已经举报过这条回复了",
		cannotSelf: "不能举报自己的回复",
		notFound: "回复不存在",
	},
	user: {
		title: "举报用户",
		permissionPassed: "您有权限举报此用户",
		duplicate: "您已经举报过这位用户了",
		cannotSelf: "不能举报自己",
		notFound: "用户不存在",
	},
};

interface ReportDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** New API: target type + id. */
	targetType?: ReportTargetType;
	targetId?: number;
	/**
	 * @deprecated Use {targetType: 'post', targetId} instead.
	 * Kept for backwards-compat with existing post-card callers.
	 */
	postId?: number;
	/** Called after successful report submission */
	onSuccess?: () => void;
}

/** Map a submit error to a user-facing message using the active type-aware copy. */
function mapSubmitError(err: unknown, copy: (typeof TYPE_COPY)[ReportTargetType]): string {
	if (!(err instanceof ApiError)) {
		return "网络错误，请重试";
	}
	switch (err.code) {
		case "DUPLICATE_REPORT":
			return copy.duplicate;
		case "CANNOT_REPORT_SELF":
			return copy.cannotSelf;
		case "TARGET_NOT_FOUND":
			return copy.notFound;
		default:
			return err.message || "提交失败，请重试";
	}
}

type Step = "permission" | "captcha" | "reason";

interface StepState {
	permission: "pending" | "loading" | "passed" | "failed";
	permissionError?: string;
	captcha: "pending" | "passed";
	reason: ReportReason | null;
}

const CAP_CONFIGURED = Boolean(CAP_API_ENDPOINT);

export function ReportDialog({
	open,
	onOpenChange,
	targetType,
	targetId,
	postId,
	onSuccess,
}: ReportDialogProps) {
	// Resolve effective target — prefer new {targetType,targetId}, fall back to legacy postId.
	const effectiveType: ReportTargetType = targetType ?? "post";
	const effectiveId: number | undefined = targetId ?? postId;
	const copy = TYPE_COPY[effectiveType];
	const toast = useForumToast();
	const [step, setStep] = useState<StepState>({
		permission: "pending",
		captcha: "pending",
		reason: null,
	});
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Cleanup timer on unmount or when dialog closes
	useEffect(() => {
		if (!open && closeTimerRef.current) {
			clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
		return () => {
			if (closeTimerRef.current) {
				clearTimeout(closeTimerRef.current);
				closeTimerRef.current = null;
			}
		};
	}, [open]);

	// Reset state when dialog opens
	useEffect(() => {
		if (open) {
			// Clear any pending close timer when reopening
			if (closeTimerRef.current) {
				clearTimeout(closeTimerRef.current);
				closeTimerRef.current = null;
			}
			setStep({
				permission: "pending",
				captcha: "pending",
				reason: null,
			});
			setSubmitting(false);
			setError(null);
			setSuccess(false);
		}
	}, [open]);

	// Check permission when dialog opens — uses unified write-gate
	useEffect(() => {
		if (!open || step.permission !== "pending") return;

		const check = async () => {
			setStep((prev) => ({ ...prev, permission: "loading" }));
			// Unified write-gate preflight: checks email + posting restrictions.
			// If blocked, the global WriteGateDialogMount handles the message.
			const blocked = await writeGatePreflight(null, "report");
			if (blocked) {
				// Write-gate dialog is already showing — close the report dialog
				onOpenChange(false);
				return;
			}
			setStep((prev) => ({ ...prev, permission: "passed" }));
		};

		check();
	}, [open, step.permission, onOpenChange]);

	const handleCapSolve = useCallback(() => {
		setStep((prev) => ({ ...prev, captcha: "passed" }));
	}, []);

	const handleCapError = useCallback(() => {
		setStep((prev) => ({ ...prev, captcha: "pending" }));
	}, []);

	const handleReasonSelect = useCallback((reason: ReportReason) => {
		setStep((prev) => ({ ...prev, reason }));
	}, []);

	const canSubmit =
		step.permission === "passed" &&
		CAP_CONFIGURED &&
		step.captcha === "passed" &&
		step.reason !== null;

	const handleSubmit = async () => {
		if (!canSubmit || submitting) return;
		if (effectiveId === undefined) {
			setError("缺少举报对象");
			return;
		}

		setSubmitting(true);
		setError(null);

		try {
			await submitReport({
				targetType: effectiveType,
				targetId: effectiveId,
				reason: step.reason as ReportReason,
			});
			setSuccess(true);
			onSuccess?.();
			toast.success("举报已提交");
			// Auto-close after showing success message
			closeTimerRef.current = setTimeout(() => {
				onOpenChange(false);
			}, 1500);
		} catch (err) {
			const message = mapSubmitError(err, copy);
			setError(message);
			toast.error({ title: "举报提交失败", description: message });
		} finally {
			setSubmitting(false);
		}
	};

	// Step indicator helper
	const getStepIcon = (_stepName: Step, state: "pending" | "loading" | "passed" | "failed") => {
		if (state === "loading") {
			return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
		}
		if (state === "passed") {
			return <CheckCircle2 className="h-4 w-4 text-success" />;
		}
		if (state === "failed") {
			return <AlertCircle className="h-4 w-4 text-destructive" />;
		}
		return <CircleDot className="h-4 w-4 text-muted-foreground" />;
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Flag className="h-5 w-5 text-destructive" />
						{copy.title}
					</DialogTitle>
					<DialogDescription>请完成以下步骤提交举报</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{/* Step 1: Permission check */}
					<div className="space-y-2">
						<div className="flex items-center gap-2 text-sm font-medium">
							{getStepIcon("permission", step.permission)}
							<span>检查权限</span>
						</div>
						{step.permission === "loading" && (
							<p className="text-sm text-muted-foreground pl-6">正在检查...</p>
						)}
						{step.permission === "passed" && (
							<p className="text-sm text-success pl-6">{copy.permissionPassed}</p>
						)}
						{step.permission === "failed" && (
							<p className="text-sm text-destructive pl-6">{step.permissionError}</p>
						)}
					</div>

					{/* Step 2: Captcha — REQUIRED. If CAP is not configured, fail-closed
					    with an error so the user knows reporting is unavailable. */}
					{step.permission === "passed" && !CAP_CONFIGURED && (
						<div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
							<AlertCircle className="h-4 w-4 shrink-0" />
							<span>人机验证服务未就绪，暂时无法举报，请稍后再试或联系管理员。</span>
						</div>
					)}
					{CAP_CONFIGURED && step.permission === "passed" && (
						<div className="space-y-2">
							<div className="flex items-center gap-2 text-sm font-medium">
								{getStepIcon("captcha", step.captcha)}
								<span>人机验证</span>
							</div>
							{step.captcha === "pending" && (
								<div className="pl-6">
									<CapWidget
										apiEndpoint={CAP_API_ENDPOINT}
										onSolve={handleCapSolve}
										onError={handleCapError}
									/>
								</div>
							)}
							{step.captcha === "passed" && <p className="text-sm text-success pl-6">验证成功</p>}
						</div>
					)}

					{/* Step 3: Reason selection (only after CAPTCHA passes) */}
					{step.permission === "passed" && CAP_CONFIGURED && step.captcha === "passed" && (
						<div className="space-y-2">
							<div className="flex items-center gap-2 text-sm font-medium">
								{step.reason ? (
									<CheckCircle2 className="h-4 w-4 text-success" />
								) : (
									<CircleDot className="h-4 w-4 text-muted-foreground" />
								)}
								<span>选择举报理由</span>
							</div>
							<div className="space-y-2 pl-6">
								{REPORT_REASONS.map((reason) => (
									<button
										key={reason}
										type="button"
										className={cn(
											"w-full flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors text-left text-sm",
											step.reason === reason
												? "border-primary bg-primary/5"
												: "border-border hover:border-primary/50",
										)}
										onClick={() => handleReasonSelect(reason)}
										disabled={submitting}
									>
										<div
											className={cn(
												"h-4 w-4 rounded-full border-2 flex items-center justify-center",
												step.reason === reason
													? "border-primary bg-primary"
													: "border-muted-foreground/50",
											)}
										>
											{step.reason === reason && (
												<div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
											)}
										</div>
										<span>{reason}</span>
									</button>
								))}
							</div>
						</div>
					)}

					{/* Success message */}
					{success && (
						<div className="flex items-center gap-2 p-3 rounded-lg bg-success/15 dark:bg-success/20 text-success text-sm">
							<CheckCircle2 className="h-4 w-4 shrink-0" />
							<span>举报提交成功，感谢您的反馈</span>
						</div>
					)}

					{/* Error message */}
					{error && (
						<div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
							<AlertCircle className="h-4 w-4 shrink-0" />
							<span>{error}</span>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
						取消
					</Button>
					<Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
						{submitting ? "提交中..." : "提交举报"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
