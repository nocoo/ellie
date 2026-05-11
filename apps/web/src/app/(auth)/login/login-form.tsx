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
import { canSubmitLogin, loginErrorMessage } from "@/viewmodels/forum/auth";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthDivider, AuthErrorBanner, AuthIdCard } from "../_components/auth-id-card";
import { RegisterFormDialog } from "../register/register-form";

const CAP_API_ENDPOINT = process.env.NEXT_PUBLIC_CAP_API_ENDPOINT ?? "";

function LoginFormInner() {
	const searchParams = useSearchParams();
	const callbackUrl = searchParams.get("redirect") ?? "/";
	const errorFromUrl = searchParams.get("error");

	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [capToken, setCapToken] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(loginErrorMessage(errorFromUrl));
	const [registerOpen, setRegisterOpen] = useState(false);

	const capEnabled = Boolean(CAP_API_ENDPOINT);
	const canSubmit = canSubmitLogin(username, password) && (!capEnabled || capToken);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!canSubmit || loading) return;

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
			} else if (result?.ok) {
				window.location.href = callbackUrl;
			}
		} catch {
			setError("网络错误，请重试");
		} finally {
			setLoading(false);
		}
	};

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
						disabled={loading}
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
						disabled={loading}
						autoComplete="current-password"
						className="h-[58px] text-base"
					/>
				</div>

				{/* Cap CAPTCHA — 58px container for visual alignment */}
				{capEnabled && (
					<div className="flex items-center justify-center h-[58px]">
						<CapWidget
							apiEndpoint={CAP_API_ENDPOINT}
							onSolve={setCapToken}
							onError={() => setCapToken("")}
						/>
					</div>
				)}

				{/* Submit */}
				<Button
					type="submit"
					disabled={!canSubmit || loading}
					className="w-full h-[58px] text-base"
				>
					{loading ? "登录中..." : "登录"}
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
