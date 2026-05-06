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
					className="relative w-[308px] overflow-hidden rounded-2xl bg-card flex flex-col ring-1 ring-black/[0.08] dark:ring-white/[0.06]"
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
					{/* Header strip with decorations */}
					<div className="bg-primary px-5 py-3">
						<div className="flex items-center justify-between">
							{/* Punch hole */}
							<div
								className="h-3 w-6 rounded-full bg-background/80"
								style={{
									boxShadow:
										"inset 0 1px 2px rgba(0,0,0,0.35), inset 0 -0.5px 1px rgba(255,255,255,0.1)",
								}}
							/>
							<span className="text-xs font-medium text-primary-foreground/60 tracking-wider">
								Since 2002
							</span>
							<div className="h-4">
								<Barcode />
							</div>
						</div>
					</div>

					{/* Form content */}
					<div className="flex flex-1 flex-col px-6 pt-6 pb-5">
						{/* Logo */}
						<div className="flex justify-center mb-6">
							<ForumLogo height={40} />
						</div>

						<form onSubmit={handleSubmit} className="space-y-4">
							{/* Error */}
							{error && (
								<div className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive text-center">
									{error}
								</div>
							)}

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

							{/* Cap CAPTCHA */}
							{capEnabled && (
								<div className="flex justify-center">
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

						{/* Divider */}
						<div className="my-5 flex items-center gap-3">
							<div className="h-px flex-1 bg-border" />
							<span className="text-xs text-muted-foreground">或</span>
							<div className="h-px flex-1 bg-border" />
						</div>

						{/* Register link */}
						<Link href="/register" className="block">
							<Button variant="outline" className="w-full h-[58px] text-base">
								创建新账号
							</Button>
						</Link>
					</div>

					{/* Footer strip */}
					<div className="flex items-center justify-center border-t border-border bg-secondary/50 py-2.5">
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
