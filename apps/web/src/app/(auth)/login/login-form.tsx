"use client";

import { CapWidget } from "@/components/cap-widget";
import { ForumLogo } from "@/components/forum/forum-logo";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeRedirect } from "@/lib/safe-redirect";
import { canSubmitLogin, loginErrorMessage } from "@/viewmodels/forum/auth";
import { useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import {
	AuthDivider,
	AuthErrorBanner,
	AuthHelpHint,
	AuthIdCard,
} from "../_components/auth-id-card";
import { RegisterFormDialog } from "../register/register-form";

const CAP_API_ENDPOINT = process.env.NEXT_PUBLIC_CAP_API_ENDPOINT ?? "";

function LoginFormInner() {
	const searchParams = useSearchParams();
	const callbackUrl = safeRedirect(searchParams.get("redirect"));
	const errorFromUrl = searchParams.get("error");

	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [capToken, setCapToken] = useState("");
	const [loading, setLoading] = useState(false);
	// `redirecting` keeps the button disabled during the post-success window
	// between `setLoading(false)` and the browser actually navigating away —
	// without it, a fast double-click could fire a second signIn request.
	const [redirecting, setRedirecting] = useState(false);
	const [error, setError] = useState<string | null>(loginErrorMessage(errorFromUrl));
	const [registerOpen, setRegisterOpen] = useState(false);

	// Synchronous in-flight lock: React state updates are async, so two rapid
	// clicks within the same tick can both pass an `if (loading) return` gate.
	// A ref-backed boolean closes that race.
	const submittingRef = useRef(false);

	const capConfigured = Boolean(CAP_API_ENDPOINT);
	const canSubmit = canSubmitLogin(username, password) && capConfigured && Boolean(capToken);
	const busy = loading || redirecting;

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!canSubmit || submittingRef.current || redirecting) return;
		submittingRef.current = true;

		setLoading(true);
		setError(null);

		try {
			const { signIn } = await import("next-auth/react");
			const result = await signIn("credentials", {
				username,
				password,
				redirect: false,
			});

			if (result?.error) {
				setError(loginErrorMessage(result.error) ?? "登录失败");
				setLoading(false);
				submittingRef.current = false;
			} else if (result?.ok) {
				// Success: switch to the redirecting state. We keep
				// `submittingRef` locked (do NOT release it) so any click
				// during the redirect window is a no-op. `loading` is
				// cleared so the label can flip to "正在跳转..."; the
				// button stays disabled because `busy = loading || redirecting`
				// is still true via `redirecting`.
				setLoading(false);
				setRedirecting(true);
				window.location.href = callbackUrl;
			} else {
				// Defensive: neither ok nor error (shouldn't happen with
				// redirect:false, but treat as a recoverable failure).
				setError("登录失败");
				setLoading(false);
				submittingRef.current = false;
			}
		} catch {
			setError("网络错误，请重试");
			setLoading(false);
			submittingRef.current = false;
		}
	};

	const submitLabel = redirecting ? "正在跳转..." : loading ? "登录中..." : "登录";

	return (
		<AuthIdCard topCenter="Since 2002">
			{/* Logo */}
			<div className="flex justify-center mb-6">
				<ForumLogo height={40} />
			</div>

			<form onSubmit={handleSubmit} className="space-y-4">
				{/* Error */}
				{error && <AuthErrorBanner message={error} />}

				{/* Username */}
				<div className="space-y-2">
					<Label htmlFor="username" className="text-sm">
						用户名
					</Label>
					<Input
						id="username"
						type="text"
						value={username}
						onChange={(e) => setUsername(e.target.value)}
						placeholder="请输入用户名"
						disabled={busy}
						autoComplete="username"
						className="h-[58px] text-base"
					/>
				</div>

				{/* Password */}
				<div className="space-y-2">
					<Label htmlFor="password" className="text-sm">
						密码
					</Label>
					<Input
						id="password"
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						placeholder="请输入密码"
						disabled={busy}
						autoComplete="current-password"
						className="h-[58px] text-base"
					/>
				</div>

				{/* Cap CAPTCHA — required. When endpoint is missing, fail-closed:
				    show an error banner and the submit button stays disabled. */}
				{capConfigured ? (
					<div className="flex items-center justify-center h-[58px]">
						<CapWidget
							apiEndpoint={CAP_API_ENDPOINT}
							onSolve={setCapToken}
							onError={() => setCapToken("")}
						/>
					</div>
				) : (
					<AuthErrorBanner message="人机验证服务未就绪，暂时无法登录，请稍后再试或联系管理员。" />
				)}

				{/* Submit */}
				<Button
					type="submit"
					disabled={!canSubmit || busy}
					aria-busy={busy}
					className="w-full h-[58px] text-base"
				>
					{submitLabel}
				</Button>
			</form>

			<AuthDivider />

			{/* Register dialog trigger */}
			<Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
				<DialogTrigger
					render={
						<Button variant="outline" className="w-full h-[58px] text-base">
							创建新账号
						</Button>
					}
				/>
				<DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto" showCloseButton>
					<DialogHeader>
						<DialogTitle>注册新账号</DialogTitle>
						<DialogDescription>创建您的同济网论坛账号</DialogDescription>
					</DialogHeader>
					<RegisterFormDialog
						onSuccess={() => {
							setRegisterOpen(false);
							window.location.href = callbackUrl;
						}}
					/>
				</DialogContent>
			</Dialog>

			{/* Contact-admin hint — rendered only after CAPTCHA solve to keep
			    the email hidden from naive scrapers. */}
			<AuthHelpHint visible={capConfigured && Boolean(capToken)} />
		</AuthIdCard>
	);
}

export default function LoginForm() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center">
					<p className="text-muted-foreground">Loading...</p>
				</div>
			}
		>
			<LoginFormInner />
		</Suspense>
	);
}
