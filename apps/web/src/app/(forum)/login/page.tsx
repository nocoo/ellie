"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import { canSubmitLogin, loginErrorMessage } from "@/viewmodels/forum/auth";
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
					<div className="mb-8 text-center">
						<div className="mx-auto h-16 w-16 rounded-full bg-primary flex items-center justify-center">
							<span className="text-2xl font-bold text-primary-foreground">E</span>
						</div>
						<h1 className="mt-4 text-xl font-semibold text-foreground">Ellie</h1>
						<p className="mt-1 text-sm text-muted-foreground">登录论坛</p>
					</div>

					{/* Login form */}
					<form onSubmit={handleSubmit} className="space-y-4">
						{/* Error */}
						{error && (
							<div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive text-center">
								{error}
							</div>
						)}

						{/* Username */}
						<div className="space-y-1.5">
							<label htmlFor="username" className="text-sm font-medium text-foreground">
								用户名
							</label>
							<input
								id="username"
								type="text"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								placeholder="请输入用户名"
								disabled={loading}
								autoComplete="username"
								className="h-10 w-full rounded-lg border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
							/>
						</div>

						{/* Password */}
						<div className="space-y-1.5">
							<label htmlFor="password" className="text-sm font-medium text-foreground">
								密码
							</label>
							<input
								id="password"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="请输入密码"
								disabled={loading}
								autoComplete="current-password"
								className="h-10 w-full rounded-lg border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
							/>
						</div>

						{/* Submit */}
						<button
							type="submit"
							disabled={!canSubmit || loading}
							className="h-10 w-full rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{loading ? "登录中..." : "登录"}
						</button>
					</form>

					{/* Footer */}
					<p className="mt-6 text-center text-xs text-muted-foreground">没有账号？联系管理员</p>
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
