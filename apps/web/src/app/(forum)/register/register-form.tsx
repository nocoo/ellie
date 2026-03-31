"use client";

// Ref: docs/04g-user-auth.md §4 — Registration page

import { registerUser } from "@/actions/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	type PasswordStrength,
	canSubmitRegister,
	passwordStrength,
	registerErrorMessage,
	validateEmail,
	validateUsername,
} from "@/viewmodels/forum/register";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Username availability status
// ---------------------------------------------------------------------------

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "banned" | "invalid" | "error";

function usernameStatusText(status: UsernameStatus): string | null {
	switch (status) {
		case "available":
			return "可以使用";
		case "taken":
			return "已被注册";
		case "banned":
			return "包含违禁词";
		case "invalid":
			return "格式不正确";
		case "checking":
			return "检查中...";
		default:
			return null;
	}
}

function usernameStatusColor(status: UsernameStatus): string {
	switch (status) {
		case "available":
			return "text-green-600 dark:text-green-400";
		case "taken":
		case "banned":
		case "invalid":
			return "text-destructive";
		case "checking":
			return "text-muted-foreground";
		default:
			return "";
	}
}

// ---------------------------------------------------------------------------
// Password strength bar
// ---------------------------------------------------------------------------

function StrengthBar({ strength }: { strength: PasswordStrength }) {
	if (strength === "none") return null;

	const config = {
		weak: { width: "w-1/3", color: "bg-red-500", label: "弱" },
		medium: { width: "w-2/3", color: "bg-yellow-500", label: "中" },
		strong: { width: "w-full", color: "bg-green-500", label: "强" },
	}[strength];

	return (
		<div className="mt-1.5 space-y-1">
			<div className="h-1 w-full rounded-full bg-muted">
				<div className={`h-full rounded-full transition-all ${config.width} ${config.color}`} />
			</div>
			<p className="text-xs text-muted-foreground">密码强度：{config.label}</p>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Register form
// ---------------------------------------------------------------------------

function RegisterFormInner() {
	const searchParams = useSearchParams();
	const callbackUrl = searchParams.get("redirect") ?? "/";

	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [email, setEmail] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");

	const formState = { username, password, confirmPassword, email };
	const canSubmit = canSubmitRegister(formState);
	const strength = passwordStrength(password);
	const usernameError = username.trim() ? validateUsername(username) : null;
	const emailError = email.trim() ? validateEmail(email) : null;
	const passwordMismatch = confirmPassword && password !== confirmPassword;

	// Debounced username availability check
	useEffect(() => {
		const localError = validateUsername(username);
		if (localError) {
			setUsernameStatus("idle");
			return;
		}

		setUsernameStatus("checking");
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(
					`/api/auth/check-username?username=${encodeURIComponent(username.trim())}`,
				);
				const data = (await res.json()) as { available: boolean; reason?: string };
				if (data.available) {
					setUsernameStatus("available");
				} else {
					setUsernameStatus((data.reason as UsernameStatus) ?? "taken");
				}
			} catch {
				setUsernameStatus("error");
			}
		}, 500);

		return () => clearTimeout(timer);
	}, [username]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!canSubmit || loading) return;

		setLoading(true);
		setError(null);

		try {
			const result = await registerUser(username.trim(), password, email.trim() || undefined);

			if ("error" in result) {
				setError(registerErrorMessage(result.error) ?? "注册失败");
				return;
			}

			// Registration success → auto-login via signIn
			const { signIn } = await import("next-auth/react");
			const signInResult = await signIn("credentials", {
				username: username.trim(),
				password,
				redirect: false,
			});

			if (signInResult?.error) {
				// Registration succeeded but auto-login failed — redirect to login
				window.location.href = `/login?redirect=${encodeURIComponent(callbackUrl)}`;
			} else if (signInResult?.ok) {
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
						<p className="mt-1 text-sm text-muted-foreground">注册新账号</p>
					</div>

					{/* Register card */}
					<Card>
						<CardHeader>
							<CardTitle className="text-base text-center">注册</CardTitle>
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
										placeholder="2-15 个字符"
										disabled={loading}
										autoComplete="username"
									/>
									{usernameError && username.trim() && (
										<p className="text-xs text-destructive">{usernameError}</p>
									)}
									{!usernameError && usernameStatusText(usernameStatus) && (
										<p className={`text-xs ${usernameStatusColor(usernameStatus)}`}>
											{usernameStatusText(usernameStatus)}
										</p>
									)}
								</div>

								{/* Password */}
								<div className="space-y-1.5">
									<Label htmlFor="password">密码</Label>
									<Input
										id="password"
										type="password"
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										placeholder="至少 6 个字符"
										disabled={loading}
										autoComplete="new-password"
									/>
									<StrengthBar strength={strength} />
								</div>

								{/* Confirm Password */}
								<div className="space-y-1.5">
									<Label htmlFor="confirmPassword">确认密码</Label>
									<Input
										id="confirmPassword"
										type="password"
										value={confirmPassword}
										onChange={(e) => setConfirmPassword(e.target.value)}
										placeholder="再次输入密码"
										disabled={loading}
										autoComplete="new-password"
									/>
									{passwordMismatch && (
										<p className="text-xs text-destructive">两次输入的密码不一致</p>
									)}
								</div>

								{/* Email */}
								<div className="space-y-1.5">
									<Label htmlFor="email">
										邮箱 <span className="text-muted-foreground">(选填)</span>
									</Label>
									<Input
										id="email"
										type="email"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										placeholder="your@email.com"
										disabled={loading}
										autoComplete="email"
									/>
									{emailError && <p className="text-xs text-destructive">{emailError}</p>}
								</div>

								{/* Submit */}
								<Button type="submit" disabled={!canSubmit || loading} className="w-full">
									{loading ? "注册中..." : "注册"}
								</Button>
							</form>
						</CardContent>
					</Card>

					{/* Footer */}
					<p className="mt-4 text-center text-xs text-muted-foreground">
						已有账号？
						<Link href="/login" className="text-primary hover:underline">
							登录
						</Link>
					</p>
				</div>
			</div>
		</div>
	);
}

export default function RegisterForm() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center">
					<p className="text-muted-foreground">Loading...</p>
				</div>
			}
		>
			<RegisterFormInner />
		</Suspense>
	);
}
