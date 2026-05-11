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

import { CapWidget } from "@/components/cap-widget";
import { useForumToast } from "@/components/forum/forum-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { requestEmailVerificationCode, verifyEmailCode } from "@/lib/forum-browser-api";
import {
	type EmailVerificationUserView,
	type FormState,
	describeWrappedError,
	initialFormState,
	isValidCodeFormat,
	isValidEmailFormat,
	nextState,
	pickCardMode,
	requestCodePreflight,
	validateCaptchaConfig,
} from "@/viewmodels/forum/email-verification";
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useState } from "react";

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
						<span
							aria-label="已验证"
							className="inline-flex items-center justify-center rounded-full bg-success/15 px-2 py-0.5 text-success text-xs dark:bg-success/20"
						>
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

interface EmailVerificationFormProps {
	initialEmail: string;
	emailEditable: boolean;
	isUnbound: boolean;
	state: FormState;
	dispatch: React.Dispatch<Parameters<typeof nextState>[1]>;
	capApiEndpoint: string;
	isConfigError: boolean;
	configErrorReason: string;
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
	onVerified,
}: EmailVerificationFormProps) {
	const toast = useForumToast();
	const [email, setEmail] = useState(initialEmail);
	const [code, setCode] = useState("");
	const [capToken, setCapToken] = useState<string | null>(null);
	const [widgetKey, setWidgetKey] = useState(0);
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
			const sentTo = typeof data?.sent_to === "string" ? data.sent_to : email;
			const nextResendAllowedAt =
				typeof data?.next_resend_allowed_at === "number" ? data.next_resend_allowed_at : 0;
			dispatch({
				type: "send_success",
				sentTo,
				nextResendAllowedAt,
			});
			toast.success(`验证码已发送至 ${sentTo}`);
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

	const inlineError =
		state.kind === "idle" ? state.error : state.kind === "code-sent" ? state.error : null;

	const showCodeInput = state.kind === "code-sent" || state.kind === "verifying";
	const sentTo = state.kind === "code-sent" || state.kind === "verifying" ? state.sentTo : "";

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

				<div className="flex flex-col gap-2">
					<Label htmlFor="email">邮箱地址</Label>
					<Input
						id="email"
						type="email"
						autoComplete="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						disabled={!emailEditable || isBusy || isConfigError}
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
							disabled={isBusy || isConfigError}
							placeholder="6 位数字"
						/>
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
							disabled={isConfigError || isBusy || !isValidEmailFormat(email) || !capToken}
						>
							{state.kind === "sending"
								? "发送中…"
								: showCodeInput
									? "重新发送验证码"
									: "发送验证码"}
						</Button>

						{showCodeInput && (
							<Button
								type="button"
								variant="default"
								onClick={handleVerify}
								disabled={isConfigError || isBusy || !isValidCodeFormat(code)}
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
