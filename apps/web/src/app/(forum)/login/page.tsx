"use client";

// Ref: 04f §11 — Login page with shadcn Card/Input/Button/Label

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canSubmitLogin, loginErrorMessage } from "@/viewmodels/forum/auth";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
	const searchParams = useSearchParams();
	const callbackUrl = searchParams.get("redirect") ?? "/";
	const errorFromUrl = searchParams.get("error");

	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(loginErrorMessage(errorFromUrl));

	const canSubmit = canSubmitLogin(username, password);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!canSubmit || loading) return;

		setLoading(true);
		setError(null);

		try {
			// Dynamic import to avoid bundling next-auth in non-login pages
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
		<div className="relative flex min-h-screen flex-col bg-background overflow-hidden">
			<div className="flex flex-1 items-center justify-center p-4">
				{/* Top-right controls */}
				<div className="absolute top-4 right-4 z-10 flex items-center gap-1">
					<ThemeToggle />
				</div>

				<div className="w-full max-w-sm">
					{/* Logo */}
					<div className="mb-6 text-center">
						<div className="mx-auto h-14 w-14 rounded-full bg-primary flex items-center justify-center">
							<span className="text-xl font-bold text-primary-foreground">E</span>
						</div>
						<h1 className="mt-3 text-lg font-semibold text-foreground">Ellie</h1>
						<p className="mt-1 text-sm text-muted-foreground">登录论坛</p>
					</div>

					{/* Login card */}
					<Card>
						<CardHeader>
							<CardTitle className="text-base text-center">登录</CardTitle>
						</CardHeader>
						<CardContent>
							<form onSubmit={handleSubmit} className="space-y-4">
								{/* Error */}
								{error && (
									<div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive text-center">
										{error}
									</div>
								)}

								{/* Username */}
								<div className="space-y-1.5">
									<Label htmlFor="username">用户名</Label>
									<Input
										id="username"
										type="text"
										value={username}
										onChange={(e) => setUsername(e.target.value)}
										placeholder="请输入用户名"
										disabled={loading}
										autoComplete="username"
									/>
								</div>

								{/* Password */}
								<div className="space-y-1.5">
									<Label htmlFor="password">密码</Label>
									<Input
										id="password"
										type="password"
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										placeholder="请输入密码"
										disabled={loading}
										autoComplete="current-password"
									/>
								</div>

								{/* Submit */}
								<Button type="submit" disabled={!canSubmit || loading} className="w-full">
									{loading ? "登录中..." : "登录"}
								</Button>
							</form>
						</CardContent>
					</Card>

					{/* Footer */}
					<p className="mt-4 text-center text-xs text-muted-foreground">
						没有账号？
						<Link href="/register" className="text-primary hover:underline">
							注册
						</Link>
					</p>
				</div>
			</div>
		</div>
	);
}

export default function ForumLoginPage() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center">
					<p className="text-muted-foreground">Loading...</p>
				</div>
			}
		>
			<LoginForm />
		</Suspense>
	);
}
