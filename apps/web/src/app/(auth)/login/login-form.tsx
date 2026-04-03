"use client";

import { CapWidget } from "@/components/cap-widget";
import { ForumLogo } from "@/components/forum/forum-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canSubmitLogin, loginErrorMessage } from "@/viewmodels/forum/auth";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

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
		<div className="relative flex min-h-screen flex-col bg-background">
			{/* Theme toggle */}
			<div className="absolute top-4 right-4 z-10">
				<ThemeToggle />
			</div>

			{/* Centered content */}
			<div className="flex flex-1 items-center justify-center p-4">
				<div className="w-full max-w-[340px]">
					{/* Logo */}
					<div className="mb-8 flex justify-center">
						<ForumLogo height={48} />
					</div>

					{/* Form */}
					<form onSubmit={handleSubmit} className="space-y-4">
						{/* Error */}
						{error && (
							<div className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive text-center">
								{error}
							</div>
						)}

						{/* Username */}
						<div className="space-y-2">
							<Label htmlFor="username">用户名</Label>
							<Input
								id="username"
								type="text"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								placeholder="请输入用户名"
								disabled={loading}
								autoComplete="username"
								className="h-11"
							/>
						</div>

						{/* Password */}
						<div className="space-y-2">
							<Label htmlFor="password">密码</Label>
							<Input
								id="password"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="请输入密码"
								disabled={loading}
								autoComplete="current-password"
								className="h-11"
							/>
						</div>

						{/* Cap CAPTCHA */}
						{capEnabled && (
							<div className="flex justify-center py-1">
								<CapWidget
									apiEndpoint={CAP_API_ENDPOINT}
									onSolve={setCapToken}
									onError={() => setCapToken("")}
								/>
							</div>
						)}

						{/* Submit */}
						<Button type="submit" disabled={!canSubmit || loading} className="w-full h-11">
							{loading ? "登录中..." : "登录"}
						</Button>
					</form>

					{/* Divider */}
					<div className="my-6 flex items-center gap-3">
						<div className="h-px flex-1 bg-border" />
						<span className="text-xs text-muted-foreground">或</span>
						<div className="h-px flex-1 bg-border" />
					</div>

					{/* Register link */}
					<Link href="/register" className="block">
						<Button variant="outline" className="w-full h-11">
							创建新账号
						</Button>
					</Link>
				</div>
			</div>
		</div>
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
