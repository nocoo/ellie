// Route: /me — the authenticated user's "self" page.
//
// Currently renders two anchored sections:
//   #email  — EmailVerificationCard (deep-linked from EMAIL_NOT_VERIFIED CTA)
//   #avatar — MeAvatarSection (deep-linked from REQUIRE_AVATAR CTA so the
//             user lands directly on the avatar uploader, not the email card).
//
// More /me sections will land in later phases (profile, notifications, etc.).
//
// Auth model
// ----------
// Server component. We resolve the current user via `getSelfForumUser()`
// (which decrypts the NextAuth cookie + calls `/api/v1/auth/me` directly
// — no GET proxy). When that returns null we redirect to
// `/login?redirect=/me` so the user lands back here after logging in.
//
// Why no client refetch
// ---------------------
// The card needs `{ email, emailVerifiedAt }` once at mount. After a
// successful verify the card calls `router.refresh()` which re-runs this
// server component, picks up the new `emailVerifiedAt`, and the card
// re-renders into its verified branch on the next paint. There is no
// long-lived client store to keep in sync.

import { ArrowUpRight, Settings2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmailVerificationCard } from "@/components/forum/email-verification-card";
import { ForumPageHeader } from "@/components/forum/forum-page-header";
import { MeAvatarSection } from "@/components/forum/me-avatar-section";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import { getSelfForumUser, toEmailVerificationUserView } from "@/lib/forum-self";
import { fetchPublicSettings, getStr } from "@/viewmodels/forum/settings.server";

export const metadata: Metadata = { title: "我的账号" };

export default async function MePage() {
	const self = await getSelfForumUser();
	if (!self) {
		// Auth gate — bounce to login with a redirect-back so the user lands
		// on /me after sign-in. Per reviewer guidance: the page is a "logged-in
		// only" surface; do not render a partial / anonymous fallback.
		redirect("/login?redirect=/me");
	}

	const settings = await fetchPublicSettings();
	const homeLabel = getStr(settings, "general.site.home_label", "同济网论坛");
	const breadcrumbs = [
		{ label: homeLabel, href: "/", icon: "home" as const },
		{ label: "我的账号" },
	];

	return (
		<div className="flex flex-col gap-4">
			<Breadcrumbs items={breadcrumbs} />
			<ForumPageHeader
				icon={<Settings2 />}
				title="我的账号"
				description="管理邮箱验证与头像，完善你的社区身份。"
				actions={
					<Button
						variant="outline"
						nativeButton={false}
						render={<Link href={`/users/${self.id}`} role="link" />}
					>
						个人主页
						<ArrowUpRight className="size-4" aria-hidden="true" />
					</Button>
				}
			/>
			<div className="grid items-stretch gap-4 lg:grid-cols-2">
				{/* The id="email" anchor is the deep-link target for Phase 7's
			    write-button dialog and the banner CTA — both will navigate to
			    `/me#email` to scroll the card into view. */}
				<section
					id="email"
					aria-labelledby="email-section-heading"
					className="min-w-0 scroll-mt-24"
				>
					<h2 id="email-section-heading" className="sr-only">
						邮箱验证
					</h2>
					<EmailVerificationCard
						user={toEmailVerificationUserView(self)}
						capApiEndpoint={process.env.NEXT_PUBLIC_CAP_API_ENDPOINT}
					/>
				</section>

				{/* The id="avatar" anchor is the deep-link target for the
			    REQUIRE_AVATAR write-gate CTA — `/me#avatar` lands the user
			    directly on the avatar uploader instead of the email card. */}
				<section
					id="avatar"
					aria-labelledby="avatar-section-heading"
					className="min-w-0 scroll-mt-24"
				>
					<MeAvatarSection userId={self.id} />
				</section>
			</div>
		</div>
	);
}
