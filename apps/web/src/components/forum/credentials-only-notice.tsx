// CredentialsOnlyNotice — Shown to Google OAuth users when they access
// features that require a forum (credentials) account.

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";

interface CredentialsOnlyNoticeProps {
	/** Feature name to display (e.g., "站内信") */
	feature: string;
}

/**
 * Notice component shown to Google OAuth users when they access
 * features that require a forum (credentials) account.
 *
 * These features need Worker JWT authentication which is only available
 * for users who logged in with credentials provider.
 */
export function CredentialsOnlyNotice({ feature }: CredentialsOnlyNoticeProps) {
	return (
		<div className="flex min-h-[400px] flex-col items-center justify-center px-4 py-12">
			<div className="mx-auto max-w-md text-center">
				<AlertCircle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
				<h2 className="text-lg font-semibold text-foreground mb-2">需要论坛账号</h2>
				<p className="text-sm text-muted-foreground mb-6">
					{feature}功能仅对论坛账号用户开放。您当前使用的是 Google 账号登录，无法使用此功能。
				</p>
				<div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
					<Link href="/" className={buttonVariants({ variant: "outline" })}>
						返回首页
					</Link>
					<Link href="/login" className={buttonVariants()}>
						使用论坛账号登录
					</Link>
				</div>
			</div>
		</div>
	);
}
