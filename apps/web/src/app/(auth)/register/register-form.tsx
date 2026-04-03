"use client";

import { registerUser } from "@/actions/auth";
import { CapWidget } from "@/components/cap-widget";
import { ForumLogo } from "@/components/forum/forum-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
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

const CAP_API_ENDPOINT = process.env.NEXT_PUBLIC_CAP_API_ENDPOINT ?? "";

/** Static barcode decoration. */
const BARS: ReadonlyArray<{ id: string; width: number; opacity: number }> = [
	2, 1, 3, 1, 2, 1, 1, 3, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1,
].map((w, i) => ({ id: `b${i}`, width: w * 1.5, opacity: i % 3 === 0 ? 0.9 : 0.5 }));

function Barcode() {
	return (
		<div className="flex items-stretch gap-[1.5px] h-full">
			{BARS.map((bar) => (
				<div
					key={bar.id}
					className="rounded-[0.5px] bg-primary-foreground"
					style={{ width: `${bar.width}px`, opacity: bar.opacity }}
				/>
			))}
		</div>
	);
}

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
		<div className="mt-1 space-y-0.5">
			<div className="h-1 w-full rounded-full bg-muted">
				<div className={`h-full rounded-full transition-all ${config.width} ${config.color}`} />
			</div>
			<p className="text-[10px] text-muted-foreground">密码强度：{config.label}</p>
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
	const [capToken, setCapToken] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");

	const capEnabled = Boolean(CAP_API_ENDPOINT);
	const formState = { username, password, confirmPassword, email };
	const canSubmit = canSubmitRegister(formState) && (!capEnabled || capToken);
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
			{/* Radial glow */}
			<div
				className="pointer-events-none absolute inset-0"
				style={{
					background: [
						"radial-gradient(ellipse 70% 55% at 50% 50%,",
						"hsl(var(--foreground) / 0.045) 0%,",
						"hsl(var(--foreground) / 0.04) 10%,",
						"hsl(var(--foreground) / 0.032) 20%,",
						"hsl(var(--foreground) / 0.025) 32%,",
						"hsl(var(--foreground) / 0.018) 45%,",
						"hsl(var(--foreground) / 0.011) 58%,",
						"hsl(var(--foreground) / 0.006) 72%,",
						"hsl(var(--foreground) / 0.002) 86%,",
						"transparent 100%)",
					].join(" "),
				}}
			/>

			{/* Theme toggle */}
			<div className="absolute top-4 right-4 z-10">
				<ThemeToggle />
			</div>

			{/* Centered content */}
			<div className="flex flex-1 items-center justify-center p-4">
				{/* Badge card */}
				<div
					className="relative w-72 overflow-hidden rounded-2xl bg-card flex flex-col ring-1 ring-black/[0.08] dark:ring-white/[0.06]"
					style={{
						boxShadow: [
							"0 1px 2px rgba(0,0,0,0.06)",
							"0 4px 8px rgba(0,0,0,0.04)",
							"0 12px 24px rgba(0,0,0,0.06)",
							"0 24px 48px rgba(0,0,0,0.04)",
							"0 0 0 0.5px rgba(0,0,0,0.02)",
							"0 0 60px rgba(0,0,0,0.03)",
						].join(", "),
					}}
				>
					{/* Header strip */}
					<div className="bg-primary px-5 py-3">
						<div className="flex items-center justify-between">
							<ForumLogo height={24} variant="dark" />
							<div className="h-5">
								<Barcode />
							</div>
						</div>
					</div>

					{/* Form content */}
					<div className="flex flex-1 flex-col px-5 pt-5 pb-4">
						<p className="text-base font-semibold text-foreground text-center">加入我们</p>
						<p className="mt-1 text-xs text-muted-foreground text-center">创建您的账号</p>

						<form onSubmit={handleSubmit} className="mt-4 space-y-3">
							{/* Error */}
							{error && (
								<div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive text-center">
									{error}
								</div>
							)}

							{/* Username */}
							<div className="space-y-1.5">
								<Label htmlFor="username" className="text-xs">
									用户名
								</Label>
								<Input
									id="username"
									type="text"
									value={username}
									onChange={(e) => setUsername(e.target.value)}
									placeholder="2-15 个字符"
									disabled={loading}
									autoComplete="username"
									className="h-9 text-sm"
								/>
								{usernameError && username.trim() && (
									<p className="text-[10px] text-destructive">{usernameError}</p>
								)}
								{!usernameError && usernameStatusText(usernameStatus) && (
									<p className={`text-[10px] ${usernameStatusColor(usernameStatus)}`}>
										{usernameStatusText(usernameStatus)}
									</p>
								)}
							</div>

							{/* Password */}
							<div className="space-y-1.5">
								<Label htmlFor="password" className="text-xs">
									密码
								</Label>
								<Input
									id="password"
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder="至少 6 个字符"
									disabled={loading}
									autoComplete="new-password"
									className="h-9 text-sm"
								/>
								<StrengthBar strength={strength} />
							</div>

							{/* Confirm Password */}
							<div className="space-y-1.5">
								<Label htmlFor="confirmPassword" className="text-xs">
									确认密码
								</Label>
								<Input
									id="confirmPassword"
									type="password"
									value={confirmPassword}
									onChange={(e) => setConfirmPassword(e.target.value)}
									placeholder="再次输入密码"
									disabled={loading}
									autoComplete="new-password"
									className="h-9 text-sm"
								/>
								{passwordMismatch && (
									<p className="text-[10px] text-destructive">两次输入的密码不一致</p>
								)}
							</div>

							{/* Email */}
							<div className="space-y-1.5">
								<Label htmlFor="email" className="text-xs">
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
									className="h-9 text-sm"
								/>
								{emailError && <p className="text-[10px] text-destructive">{emailError}</p>}
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
							<Button type="submit" disabled={!canSubmit || loading} className="w-full h-9 text-sm">
								{loading ? "注册中..." : "创建账号"}
							</Button>
						</form>

						{/* Divider */}
						<div className="my-4 flex items-center gap-3">
							<div className="h-px flex-1 bg-border" />
							<span className="text-[10px] text-muted-foreground">或</span>
							<div className="h-px flex-1 bg-border" />
						</div>

						{/* Login link */}
						<Link href="/login" className="block">
							<Button variant="outline" className="w-full h-9 text-sm">
								已有账号，去登录
							</Button>
						</Link>
					</div>

					{/* Footer strip */}
					<div className="flex items-center justify-center border-t border-border bg-secondary/50 py-2">
						<div className="flex items-center gap-1.5">
							<div className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
							<span className="text-[10px] text-muted-foreground">安全连接</span>
						</div>
					</div>
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
