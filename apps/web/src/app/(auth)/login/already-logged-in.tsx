"use client";

import { ForumLogo } from "@/components/forum/forum-logo";
import { Button } from "@/components/ui/button";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
			await signOut({ redirect: false });
			// Reload so the server component re-evaluates auth() → shows login form
			window.location.reload();
		} catch {
			setSigningOut(false);
		}
	};

	return (
		<AuthIdCard topCenter="Since 2002">
			<div className="flex justify-center mb-6">
				<ForumLogo height={40} />
			</div>

			<div className="text-center space-y-4">
				<div className="space-y-1.5">
					<p className="text-base font-medium">你已登录</p>
					{username && <p className="text-sm text-muted-foreground">当前账号：{username}</p>}
				</div>

				<Button onClick={handleGoHome} className="w-full h-[58px] text-base">
					前往首页
				</Button>

				<button
					type="button"
					onClick={handleSwitchAccount}
					disabled={signingOut}
					className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
				>
					{signingOut ? "退出中..." : "切换账号"}
				</button>
			</div>
		</AuthIdCard>
	);
}
