"use client";

import { ArrowRight, CircleUserRound, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthIdCard } from "../_components/auth-id-card";

interface AlreadyLoggedInProps {
	username: string;
}

/**
 * Shown when an authenticated user navigates to /login.
 *
 * Instead of silently redirecting (which can confuse users into thinking "any
 * password works"), this card explicitly states the user is already logged in
 * and offers clear next steps: go to the home page or switch accounts.
 */
export default function AlreadyLoggedIn({ username }: AlreadyLoggedInProps) {
	const router = useRouter();
	const [signingOut, setSigningOut] = useState(false);

	const handleGoHome = () => {
		router.push("/");
	};

	const handleSwitchAccount = async () => {
		setSigningOut(true);
		try {
			// Full-navigation signOut (matching every other signOut call in this
			// app). Letting NextAuth own the navigation guarantees the browser
			// commits the cookie-clearing Set-Cookie headers before it re-fetches
			// /login, so the server component sees the cleared session and renders
			// the real login form. A prior "redirect: false" + manual
			// location.reload() raced the cookie commit and intermittently
			// re-rendered this card in Playwright (see auth.spec.ts).
			await signOut({ callbackUrl: "/login" });
		} catch {
			setSigningOut(false);
		}
	};

	return (
		<AuthIdCard topCenter="Since 2002">
			<div className="mx-auto w-full max-w-sm space-y-5">
				<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
					<CircleUserRound className="size-6" aria-hidden="true" />
				</div>
				<div className="space-y-2">
					<h1 className="text-2xl font-semibold tracking-tight">你已登录</h1>
					{username && (
						<p className="break-words text-sm text-muted-foreground">当前账号：{username}</p>
					)}
				</div>

				<Button onClick={handleGoHome} disabled={signingOut} className="h-11 w-full">
					前往首页
					<ArrowRight className="size-4" aria-hidden="true" />
				</Button>

				<Button
					type="button"
					variant="outline"
					onClick={handleSwitchAccount}
					disabled={signingOut}
					className="h-11 w-full"
				>
					<LogOut className="size-4" aria-hidden="true" />
					{signingOut ? "退出中..." : "切换账号"}
				</Button>
			</div>
		</AuthIdCard>
	);
}
