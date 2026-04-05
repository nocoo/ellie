"use client";

// components/forum/report-dialog.tsx — Post report dialog with three-step verification

import { CapWidget } from "@/components/cap-widget";
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
	checkReportPermission,
	submitReport,
} from "@/viewmodels/forum/report";
import { AlertCircle, CheckCircle2, CircleDot, Flag, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const CAP_API_ENDPOINT = process.env.NEXT_PUBLIC_CAP_API_ENDPOINT ?? "";

interface ReportDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	postId: number;
	/** Called after successful report submission */
	onSuccess?: () => void;
}

type Step = "permission" | "captcha" | "reason";

interface StepState {
	permission: "pending" | "loading" | "passed" | "failed";
	permissionError?: string;
	captcha: "pending" | "passed" | "skipped";
	reason: ReportReason | null;
}

export function ReportDialog({ open, onOpenChange, postId, onSuccess }: ReportDialogProps) {
	const [step, setStep] = useState<StepState>({
		permission: "pending",
		captcha: CAP_API_ENDPOINT ? "pending" : "skipped",
		reason: null,
	});
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	// Reset state when dialog opens
	useEffect(() => {
		if (open) {
			setStep({
				permission: "pending",
				captcha: CAP_API_ENDPOINT ? "pending" : "skipped",
				reason: null,
			});
			setSubmitting(false);
			setError(null);
			setSuccess(false);
		}
	}, [open]);

	// Check permission when dialog opens
	useEffect(() => {
		if (!open || step.permission !== "pending") return;

		const check = async () => {
			setStep((prev) => ({ ...prev, permission: "loading" }));
			try {
				const result = await checkReportPermission();
				if (result.allowed) {
					setStep((prev) => ({ ...prev, permission: "passed" }));
				} else {
					setStep((prev) => ({
						...prev,
						permission: "failed",
						permissionError: result.reason || "无法举报",
					}));
				}
			} catch {
				setStep((prev) => ({
					...prev,
					permission: "failed",
					permissionError: "检查权限失败，请重试",
				}));
			}
		};

		check();
	}, [open, step.permission]);

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
		(step.captcha === "passed" || step.captcha === "skipped") &&
		step.reason !== null;

	const handleSubmit = async () => {
		if (!canSubmit || submitting) return;

		setSubmitting(true);
		setError(null);

		try {
			await submitReport({ postId, reason: step.reason as ReportReason });
			setSuccess(true);
			onSuccess?.();
			// Auto-close after showing success message
			setTimeout(() => {
				onOpenChange(false);
			}, 1500);
		} catch (err) {
			if (err instanceof ApiError) {
				// Handle specific error codes (match Worker error codes)
				if (err.code === "DUPLICATE_REPORT") {
					setError("您已经举报过这个帖子了");
				} else if (err.code === "CANNOT_REPORT_SELF") {
					setError("不能举报自己的帖子");
				} else if (err.code === "TARGET_NOT_FOUND") {
					setError("帖子不存在");
				} else {
					setError(err.message || "提交失败，请重试");
				}
			} else {
				setError("网络错误，请重试");
			}
		} finally {
			setSubmitting(false);
		}
	};

	// Step indicator helper
	const getStepIcon = (
		_stepName: Step,
		state: "pending" | "loading" | "passed" | "failed" | "skipped",
	) => {
		if (state === "loading") {
			return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
		}
		if (state === "passed" || state === "skipped") {
			return <CheckCircle2 className="h-4 w-4 text-green-500" />;
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
						<Flag className="h-5 w-5 text-orange-500" />
						举报内容
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
							<p className="text-sm text-green-600 dark:text-green-400 pl-6">您有权限举报此帖子</p>
						)}
						{step.permission === "failed" && (
							<p className="text-sm text-destructive pl-6">{step.permissionError}</p>
						)}
					</div>

					{/* Step 2: Captcha (only show if enabled and permission passed) */}
					{CAP_API_ENDPOINT && step.permission === "passed" && (
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
							{step.captcha === "passed" && (
								<p className="text-sm text-green-600 dark:text-green-400 pl-6">验证成功</p>
							)}
						</div>
					)}

					{/* Step 3: Reason selection (only show if previous steps passed) */}
					{step.permission === "passed" &&
						(step.captcha === "passed" || step.captcha === "skipped") && (
							<div className="space-y-2">
								<div className="flex items-center gap-2 text-sm font-medium">
									{step.reason ? (
										<CheckCircle2 className="h-4 w-4 text-green-500" />
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
						<div className="flex items-center gap-2 p-3 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 text-sm">
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
