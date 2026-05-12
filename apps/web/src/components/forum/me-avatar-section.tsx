"use client";

// Avatar section for the /me page.
//
// Why this exists
// ---------------
// The write-gate REQUIRE_AVATAR CTA navigates to `/me#avatar`. Before this
// section existed `/me` only rendered the email-verification card, so users
// who clicked "去设置头像" landed on what looked like the verification page.
// This component gives that anchor a real home: an avatar uploader the user
// can interact with immediately.
//
// Behavior mirrors `ProfileEditDialog`'s avatar flow:
// - reuse the shared `AvatarUpload` widget (upload API, validation, toast,
//   `invalidateWriteGateCache()` all stay inside it),
// - on success, update the avatar version context so every avatar on the
//   page repaints from the fresh URL, then call `router.refresh()` to
//   re-run the server component for any avatar-dependent rendering.

import { AvatarUpload } from "@/components/forum/avatar-upload";
import { useAvatarUrl, useAvatarVersion } from "@/contexts/avatar-context";
import { useRouter } from "next/navigation";

export interface MeAvatarSectionProps {
	userId: number;
}

export function MeAvatarSection({ userId }: MeAvatarSectionProps) {
	const router = useRouter();
	const { updateVersion } = useAvatarVersion();
	const avatarUrl = useAvatarUrl(userId);

	const handleAvatarUploadComplete = (newUrl: string) => {
		const match = newUrl.match(/[?&]v=(\d+)/);
		const version = match ? Number.parseInt(match[1], 10) : Date.now();
		updateVersion(userId, version);
		router.refresh();
	};

	return (
		<div className="rounded-xl border border-border bg-card/60 p-4 sm:p-5">
			<div className="mb-3 flex items-center gap-2">
				<span className="h-1 w-1 rounded-full bg-primary" />
				<h3 id="avatar-section-heading" className="text-sm font-medium text-foreground">
					头像
				</h3>
			</div>
			<p className="mb-4 text-xs text-muted-foreground leading-relaxed">
				设置头像后即可发帖/回帖/评论。支持 JPG、PNG，最大 200 KB。
			</p>
			<AvatarUpload currentUrl={avatarUrl} onUploadComplete={handleAvatarUploadComplete} />
		</div>
	);
}
