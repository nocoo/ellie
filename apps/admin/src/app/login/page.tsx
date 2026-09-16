"use client";

import { ADMIN_LOGO, SITE_ART } from "@ellie/shared";
import { VERSION_DISPLAY } from "@ellie/types";
import { Button, LayerCard, Separator, ThemeToggle } from "@nocoo/basalt";
import { LoadingScreen } from "@nocoo/basalt/components/loading-screen";
import { useSearchParams } from "next/navigation";
import { type CSSProperties, Suspense } from "react";
import { useFormStatus } from "react-dom";
import { signInWithGoogle } from "./actions";

/** Static barcode decoration for the badge header. */
const BARS: ReadonlyArray<{ id: string; width: number; opacity: number }> = [
	2, 1, 3, 1, 2, 1, 1, 3, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1,
].map((w, i) => ({ id: `b${i}`, width: w * 1.5, opacity: i % 3 === 0 ? 0.9 : 0.5 }));

function Barcode() {
	return (
		<div className="flex items-stretch gap-[1.5px] h-full">
			{BARS.map((bar) => (
				<div
					key={bar.id}
					className="rounded-[0.5px] bg-basalt-primary-foreground"
					style={{ width: `${bar.width}px`, opacity: bar.opacity }}
				/>
			))}
		</div>
	);
}

function GoogleIcon() {
	return (
		<svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
				fill="#4285F4"
			/>
			<path
				d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
				fill="#34A853"
			/>
			<path
				d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
				fill="#FBBC05"
			/>
			<path
				d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
				fill="#EA4335"
			/>
		</svg>
	);
}

function GoogleSignInButton() {
	const { pending } = useFormStatus();
	return (
		<Button type="submit" variant="secondary" className="w-full" loading={pending}>
			<GoogleIcon />
			使用 Google 登录
		</Button>
	);
}

function LoginContent() {
	const error = useSearchParams().get("error");
	const today = new Date().toISOString().slice(0, 10);
	return (
		<div
			className="admin-campus relative isolate flex min-h-screen items-center justify-center bg-basalt-background p-4"
			style={
				{
					"--sketch-light": SITE_ART.admin.light.imageSet,
					"--sketch-dark": SITE_ART.admin.dark.imageSet,
				} as CSSProperties
			}
		>
			<div className="absolute right-4 top-4">
				<ThemeToggle aria-label="切换主题" />
			</div>
			<LayerCard
				data-basalt-surface-root=""
				padding="none"
				className="relative flex aspect-[54/86] w-72 max-w-full flex-col rounded-2xl shadow-xl ring-1 ring-basalt-border/40"
			>
				<div className="bg-basalt-primary px-5 py-4 text-basalt-primary-foreground">
					<div className="flex items-center justify-between gap-2">
						<div className="h-4 w-8 shrink-0 rounded-full bg-basalt-background/80 shadow-inner" />
						<span className="text-sm font-semibold">Ellie 管理后台</span>
						<span className="text-[10px]">{VERSION_DISPLAY}</span>
					</div>
					<div className="mt-3 flex items-center justify-between">
						<span className="font-mono text-[9px]">ID {today}</span>
						<div className="h-6" aria-hidden="true">
							<Barcode />
						</div>
					</div>
				</div>
				<div className="flex flex-1 flex-col items-center px-6 py-6">
					<img
						src={ADMIN_LOGO.src}
						srcSet={ADMIN_LOGO.srcSet}
						sizes="96px"
						alt="Ellie"
						width={96}
						height={96}
						fetchPriority="high"
					/>
					<h1 className="mt-5 text-lg font-semibold">管理控制台</h1>
					<p className="mt-1 text-xs text-basalt-muted-foreground">登录以管理论坛</p>
					{error && (
						<p role="alert" className="mt-3 text-center text-xs text-basalt-destructive">
							{error === "AccessDenied" ? "您的账号无权访问此应用。" : "登录失败，请重试。"}
						</p>
					)}
					<Separator className="my-5" />
					<form action={signInWithGoogle} className="w-full">
						<GoogleSignInButton />
					</form>
					<p className="mt-3 text-center text-[10px] text-basalt-muted-foreground">
						仅授权管理员可访问。
					</p>
				</div>
				<LayerCard.Footer className="justify-center text-[10px] text-basalt-muted-foreground">
					<span
						className="mr-1.5 h-1.5 w-1.5 rounded-full bg-basalt-badge-green-foreground"
						aria-hidden="true"
					/>
					安全认证
				</LayerCard.Footer>
			</LayerCard>
		</div>
	);
}

export default function LoginPage() {
	return (
		<Suspense
			fallback={
				<LoadingScreen
					label="加载中"
					mark={
						<img
							src={ADMIN_LOGO.src}
							srcSet={ADMIN_LOGO.srcSet}
							sizes="24px"
							alt="Ellie"
							width={24}
							height={24}
						/>
					}
				/>
			}
		>
			<LoginContent />
		</Suspense>
	);
}
