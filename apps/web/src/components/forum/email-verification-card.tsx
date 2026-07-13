"use client";

// EmailVerificationCard — the public face of the email-verification flow.
//
// Structure
// ---------
// This component is intentionally thin. All non-trivial logic — state machine,
// request body shape, error mapping, Cap config validation — lives in
// `apps/web/src/viewmodels/forum/email-verification.ts`. Tests live there. This
// file is the wire-up: render the right stack for the user's mode, drive the
// reducer with form events, fetch the proxy routes, and forward Cap callbacks.

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useState } from "react";
import { CapWidget } from "@/components/cap-widget";
import { useForumToast } from "@/components/forum/forum-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
	correctPendingEmailAddress,
	requestEmailVerificationCode,
	verifyEmailCode,
} from "@/lib/forum-browser-api";
import {
	describeWrappedError,
	type EmailVerificationUserView,
	type FormState,
	initialFormState,
	isValidCodeFormat,
	isValidEmailFormat,
	nextState,
	pickCardMode,
	requestCodePreflight,
	validateCaptchaConfig,
} from "@/viewmodels/forum/email-verification";
import { invalidateWriteGateCache } from "@/viewmodels/forum/write-gate";

// Default code TTL in seconds (matches worker CODE_TTL_SECONDS).
const DEFAULT_CODE_TTL = 900;

export interface EmailVerificationCardProps {
	user: EmailVerificationUserView;
	/** NEXT_PUBLIC_CAP_API_ENDPOINT — passed in so the page renders fail-closed
	 *  when env var is missing instead of crashing the client bundle. */
	capApiEndpoint: string | undefined;
	/**
	 * If set, navigate to this URL after successful email verification instead
	 * of refreshing the current page. Use `/` to redirect to the homepage
	 * after standalone verification flow.
	 */
	redirectAfterVerify?: string;
}

export function EmailVerificationCard({
	user,
	capApiEndpoint,
	redirectAfterVerify,
}: EmailVerificationCardProps) {
	const router = useRouter();
	const mode = pickCardMode(user);

	const cfg = validateCaptchaConfig(capApiEndpoint);
	const [state, dispatch] = useReducer(
		nextState,
		cfg.ok ? initialFormState : ({ kind: "config-error", reason: cfg.reason } as FormState),
	);
	useEffect(() => {
		if (!cfg.ok && state.kind !== "config-error") {
			dispatch({ type: "config_invalid", reason: cfg.reason });
		}
	}, [cfg, state.kind]);

	// ── Verified branch ──────────────────────────────────────────────────────
	if (mode.kind === "verified") {
		return (
			<Card>
				<CardHeader>
					<CardTitle>邮箱验证</CardTitle>
				</CardHeader>
				<CardContent className="px-4">
					<div className="flex items-center gap-2 text-sm">
						<span className="inline-flex items-center justify-center rounded-full bg-success/15 px-2 py-0.5 text-success text-xs dark:bg-success/20">
							✓ 已验证
						</span>
						<span className="text-muted-foreground">
							{mode.email !== "" ? mode.email : "已验证邮箱（系统未保留地址）"}
						</span>
					</div>
				</CardContent>
			</Card>
		);
	}

	// ── Form branch (unbound / unverified) ───────────────────────────────────
	const showCorrection = mode.kind === "unverified" && (user.emailChangedAt ?? 0) === 0;
	return (
		<EmailVerificationForm
			initialEmail={mode.kind === "unverified" ? mode.email : ""}
			emailEditable={mode.kind === "unbound"}
			isUnbound={mode.kind === "unbound"}
			state={state}
			dispatch={dispatch}
			capApiEndpoint={cfg.ok ? cfg.apiEndpoint : ""}
			isConfigError={!cfg.ok}
			configErrorReason={cfg.ok ? "" : cfg.reason}
			showCorrection={showCorrection}
			onCorrected={() => router.refresh()}
			onVerified={() => {
				if (redirectAfterVerify) {
					// Delay to let user see the success toast before navigating away
					setTimeout(() => router.push(redirectAfterVerify), 1500);
				} else {
					router.refresh();
				}
			}}
		/>
	);
}

// ── Helpers (module-level to keep EmailVerificationForm under complexity budget) ──

/** Extract code-sent / verifying fields from state, with safe defaults. */
function extractCodeFields(state: FormState): {
	sentTo: string;
	nextResendAllowedAt: number;
	codeDeadline: number;
	inlineError: string | null;
	showCodeInput: boolean;
} {
	if (state.kind === "code-sent") {
		return {
			sentTo: state.sentTo,
			nextResendAllowedAt: state.nextResendAllowedAt,
			codeDeadline: state.codeDeadline,
			inlineError: state.error,
			showCodeInput: true,
		};
	}
	if (state.kind === "verifying") {
		return {
			sentTo: state.sentTo,
			nextResendAllowedAt: state.nextResendAllowedAt,
			codeDeadline: state.codeDeadline,
			inlineError: null,
			showCodeInput: true,
		};
	}
	return {
		sentTo: "",
		nextResendAllowedAt: 0,
		codeDeadline: 0,
		inlineError: state.kind === "idle" ? state.error : null,
		showCodeInput: false,
	};
}

function formatCountdown(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

function getSendButtonLabel(
	stateKind: FormState["kind"],
	showCodeInput: boolean,
	resendCooldownLeft: number,
): string {
	if (stateKind === "sending") return "发送中…";
	if (!showCodeInput) return "发送验证码";
	if (resendCooldownLeft > 0) return `重新发送 (${formatCountdown(resendCooldownLeft)})`;
	return "重新发送验证码";
}

/** Parse optional fields from the request-code response into dispatch-ready values. */
function parseSendCodeResponse(
	data: { sent_to?: string; next_resend_allowed_at?: number; expires_in?: number } | undefined,
	fallbackEmail: string,
): { sentTo: string; nextResendAllowedAt: number; codeDeadline: number } {
	const sentTo = typeof data?.sent_to === "string" ? data.sent_to : fallbackEmail;
	const nextResendAllowedAt =
		typeof data?.next_resend_allowed_at === "number" ? data.next_resend_allowed_at : 0;
	const expiresIn = typeof data?.expires_in === "number" ? data.expires_in : DEFAULT_CODE_TTL;
	const codeDeadline = Math.floor(Date.now() / 1000) + expiresIn;
	return { sentTo, nextResendAllowedAt, codeDeadline };
}

interface EmailVerificationFormProps {
	initialEmail: string;
	emailEditable: boolean;
	isUnbound: boolean;
	state: FormState;
	dispatch: React.Dispatch<Parameters<typeof nextState>[1]>;
	capApiEndpoint: string;
	isConfigError: boolean;
	configErrorReason: string;
	/**
	 * Show the one-shot "纠错一次" affordance. Only set when the user is
	 * unverified AND has not used their correction yet (`emailChangedAt === 0`).
	 */
	showCorrection: boolean;
	/** Called after a successful correction so the parent can `router.refresh()`. */
	onCorrected: () => void;
	onVerified: () => void;
}

function EmailVerificationForm({
	initialEmail,
	emailEditable,
	isUnbound,
	state,
	dispatch,
	capApiEndpoint,
	isConfigError,
	configErrorReason,
	showCorrection,
	onCorrected,
	onVerified,
}: EmailVerificationFormProps) {
	const toast = useForumToast();
	const [email, setEmail] = useState(initialEmail);
	const [code, setCode] = useState("");
	const [capToken, setCapToken] = useState<string | null>(null);
	const [widgetKey, setWidgetKey] = useState(0);
	const [isEditingEmail, setIsEditingEmail] = useState(false);
	// One-shot correction sub-flow — orthogonal to the request-code state
	// machine. Local state is fine because there's no shared transition.
	const [correctionOpen, setCorrectionOpen] = useState(false);
	const [correctionEmail, setCorrectionEmail] = useState(initialEmail);
	const [correctionBusy, setCorrectionBusy] = useState(false);
	const [correctionError, setCorrectionError] = useState<string | null>(null);
	const resetCap = () => {
		setCapToken(null);
		setWidgetKey((k) => k + 1);
	};

	// Watch verified → fire onVerified once.
	const verifiedFired = useRef(false);
	useEffect(() => {
		if (state.kind === "verified" && !verifiedFired.current) {
			verifiedFired.current = true;
			onVerified();
		}
	}, [state.kind, onVerified]);

	const isBusy = state.kind === "sending" || state.kind === "verifying";
	const isVerified = state.kind === "verified";
	const { sentTo, nextResendAllowedAt, codeDeadline, inlineError, showCodeInput } =
		extractCodeFields(state);

	const handleSendCode = async () => {
		if (isConfigError || isBusy) return;
		const preflightError = requestCodePreflight({
			apiEndpoint: capApiEndpoint,
			capToken,
			email,
		});
		if (preflightError) {
			dispatch({ type: "send_error", message: preflightError });
			toast.error({ title: "验证码发送失败", description: preflightError });
			resetCap();
			return;
		}
		dispatch({ type: "send_start" });
		try {
			const data = await requestEmailVerificationCode(email);
			const parsed = parseSendCodeResponse(data, email);
			dispatch({ type: "send_success", ...parsed });
			toast.success(`验证码已发送至 ${parsed.sentTo}`);
			resetCap();
		} catch (err) {
			if (err instanceof ApiError) {
				const message = describeWrappedError(err.rawBody, err.status);
				dispatch({ type: "send_error", message });
				toast.error({ title: "验证码发送失败", description: message });
				resetCap();
				return;
			}
			dispatch({ type: "send_error", message: "网络错误，请稍后重试。" });
			toast.error({ title: "验证码发送失败", description: "网络错误，请稍后重试。" });
			resetCap();
		}
	};

	const handleVerify = async () => {
		if (isConfigError || state.kind !== "code-sent") return;
		dispatch({ type: "verify_start" });
		try {
			await verifyEmailCode(email, code);
			dispatch({ type: "verify_success" });
			invalidateWriteGateCache();
			toast.success("邮箱已验证");
		} catch (err) {
			if (err instanceof ApiError) {
				const message = describeWrappedError(err.rawBody, err.status);
				dispatch({ type: "verify_error", message });
				toast.error({ title: "邮箱验证失败", description: message });
				return;
			}
			dispatch({ type: "verify_error", message: "网络错误，请稍后重试。" });
			toast.error({ title: "邮箱验证失败", description: "网络错误，请稍后重试。" });
		}
	};

	const handleChangeEmail = () => {
		dispatch({ type: "reset_to_idle" });
		setCode("");
		setIsEditingEmail(true);
		resetCap();
	};

	const handleCorrect = async () => {
		if (correctionBusy) return;
		const trimmed = correctionEmail.trim();
		if (!isValidEmailFormat(trimmed)) {
			setCorrectionError("邮箱格式无效，请检查后重试。");
			return;
		}
		// Same-as-current guard. Mirrors the Worker check so users can never
		// burn their one-shot correction on a no-op submit (e.g. just pressing
		// 保存 without editing the pre-filled address).
		if (trimmed.toLowerCase() === initialEmail.trim().toLowerCase()) {
			setCorrectionError("新邮箱与当前邮箱相同，无需纠错。");
			return;
		}
		setCorrectionBusy(true);
		setCorrectionError(null);
		try {
			await correctPendingEmailAddress(trimmed);
			toast.success(`邮箱已更新为 ${trimmed}`);
			// Surface to the parent so it can re-fetch the user (the new
			// `emailChangedAt` will hide this affordance on next render).
			onCorrected();
		} catch (err) {
			if (err instanceof ApiError) {
				const message = describeWrappedError(err.rawBody, err.status);
				setCorrectionError(message);
				toast.error({ title: "邮箱纠错失败", description: message });
			} else {
				const message = "网络错误，请稍后重试。";
				setCorrectionError(message);
				toast.error({ title: "邮箱纠错失败", description: message });
			}
		} finally {
			setCorrectionBusy(false);
		}
	};

	// ── Countdown timers ─────────────────────────────────────────────────
	const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

	useEffect(() => {
		if (!showCodeInput) return;
		const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
		return () => clearInterval(id);
	}, [showCodeInput]);

	const resendCooldownLeft = Math.max(0, nextResendAllowedAt - now);
	const codeExpiryLeft = Math.max(0, codeDeadline - now);
	const codeExpired = showCodeInput && codeExpiryLeft === 0;

	return (
		<Card>
			<CardHeader>
				<CardTitle>{isUnbound ? "绑定并验证邮箱" : "验证邮箱"}</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4 px-4">
				{isConfigError && (
					<div
						role="alert"
						className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive text-sm"
					>
						{configErrorReason}
					</div>
				)}

				{showCorrection && !isConfigError && (
					<div className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 text-amber-900 text-xs dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
						{!correctionOpen ? (
							<div className="flex flex-wrap items-center justify-between gap-2">
								<span>注册邮箱写错了？验证前可以纠错一次。</span>
								<button
									type="button"
									className="underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-100"
									onClick={() => {
										setCorrectionOpen(true);
										setCorrectionEmail(initialEmail);
										setCorrectionError(null);
									}}
								>
									纠错一次
								</button>
							</div>
						) : (
							<div className="flex flex-col gap-2">
								<Label
									htmlFor="correction-email"
									className="text-xs text-amber-900 dark:text-amber-200"
								>
									正确的邮箱地址
								</Label>
								<Input
									id="correction-email"
									type="email"
									autoComplete="email"
									value={correctionEmail}
									onChange={(e) => setCorrectionEmail(e.target.value)}
									disabled={correctionBusy}
									placeholder="you@example.com"
								/>
								{correctionError && (
									<div role="alert" className="text-destructive">
										{correctionError}
									</div>
								)}
								<div className="flex items-center gap-2">
									<Button
										type="button"
										size="sm"
										onClick={handleCorrect}
										disabled={
											correctionBusy ||
											!isValidEmailFormat(correctionEmail) ||
											correctionEmail.trim().toLowerCase() === initialEmail.trim().toLowerCase()
										}
									>
										{correctionBusy ? "保存中…" : "保存（仅一次机会）"}
									</Button>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										onClick={() => {
											setCorrectionOpen(false);
											setCorrectionError(null);
										}}
										disabled={correctionBusy}
									>
										取消
									</Button>
								</div>
							</div>
						)}
					</div>
				)}

				<div className="flex flex-col gap-2">
					<Label htmlFor="email">邮箱地址</Label>
					<Input
						id="email"
						type="email"
						autoComplete="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						disabled={(!emailEditable && !isEditingEmail) || isBusy || isConfigError}
						placeholder="you@example.com"
					/>
				</div>

				{!isConfigError && !isVerified && (
					<div className="flex flex-col gap-1">
						<CapWidget
							key={widgetKey}
							apiEndpoint={capApiEndpoint}
							onSolve={(tok) => setCapToken(tok)}
							onError={() => resetCap()}
						/>
					</div>
				)}

				{showCodeInput && (
					<div className="flex flex-col gap-2">
						<Label htmlFor="code">验证码（已发送至 {sentTo}）</Label>
						<Input
							id="code"
							inputMode="numeric"
							autoComplete="one-time-code"
							maxLength={6}
							value={code}
							onChange={(e) => setCode(e.target.value)}
							disabled={isBusy || isConfigError || codeExpired}
							placeholder="6 位数字"
						/>
						<div className="flex items-center gap-3 text-xs text-muted-foreground">
							{codeExpired ? (
								<span className="text-destructive">验证码已过期，请重新发送</span>
							) : (
								<span>有效期剩余 {formatCountdown(codeExpiryLeft)}</span>
							)}
							{resendCooldownLeft > 0 && (
								<span>{formatCountdown(resendCooldownLeft)} 后可重发</span>
							)}
						</div>
						{resendCooldownLeft === 0 && !isBusy && (
							<button
								type="button"
								className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
								onClick={handleChangeEmail}
							>
								没收到？修改邮箱
							</button>
						)}
					</div>
				)}

				{inlineError && (
					<div role="alert" className="text-destructive text-sm">
						{inlineError}
					</div>
				)}

				{isVerified ? (
					<output className="flex items-center gap-2 rounded-md bg-success/10 p-3 text-sm text-success">
						<span>✓ 邮箱验证成功</span>
					</output>
				) : (
					<div className="flex items-center gap-2">
						<Button
							type="button"
							onClick={handleSendCode}
							disabled={
								isConfigError ||
								isBusy ||
								!isValidEmailFormat(email) ||
								!capToken ||
								resendCooldownLeft > 0
							}
						>
							{getSendButtonLabel(state.kind, showCodeInput, resendCooldownLeft)}
						</Button>

						{showCodeInput && (
							<Button
								type="button"
								variant="default"
								onClick={handleVerify}
								disabled={isConfigError || isBusy || !isValidCodeFormat(code) || codeExpired}
							>
								{state.kind === "verifying" ? "验证中…" : "验证"}
							</Button>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
