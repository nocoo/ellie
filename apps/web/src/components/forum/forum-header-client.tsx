"use client";

// Client wrapper for forum page header with new thread button
// Manages new thread dialog state. Phase 7-4: optionally short-circuits
// the dialog open with a §5.4 preflight when the parent server page can
// reliably tell us the user is unverified — see `selfEmailVerifiedAt`.

import type { Forum } from "@ellie/types";
import { Award, Hash, Megaphone, PenLine } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AnnouncementCard } from "@/components/forum/announcement-card";
import { AnnouncementEditDialog } from "@/components/forum/announcement-edit-dialog";
import { NewThreadDialog } from "@/components/forum/new-thread-dialog";
import { SafeHtml } from "@/components/forum/safe-html";
import { Button } from "@/components/ui/button";
import type { ForumThreadTypesPublic } from "@/viewmodels/forum/thread-types";
import { writeGatePreflight } from "@/viewmodels/forum/write-gate";
import { formatNumber } from "@/viewmodels/shared/formatting";
import { ForumPageHeader } from "./forum-page-header";

interface ForumHeaderClientProps {
	forum: Forum;
	isGroup: boolean;
	/**
	 * Server-side projected `emailVerifiedAt` for the current user.
	 * `null` means anonymous OR the loader fail-soft pathed (server
	 * couldn't tell). Per Phase 7-4 reviewer guidance (msg 58c38e78),
	 * we only block when this is exactly `0`; null falls through to the
	 * api-client interceptor backstop.
	 */
	selfEmailVerifiedAt: number | null;
	/** Server-injected 主题分类 payload (null when feature off / load failed). */
	threadTypes?: ForumThreadTypesPublic | null;
	/**
	 * Server-computed permission flag — true when the current user has
	 * Mod-or-higher rights on this specific forum (Admin / SuperMod
	 * unconditional; Mod must appear in `forum.moderators`). UX-only;
	 * the Worker enforces the real boundary.
	 */
	canEditAnnouncement?: boolean;
}

export function ForumHeaderClient({
	forum,
	isGroup,
	selfEmailVerifiedAt,
	threadTypes = null,
	canEditAnnouncement = false,
}: ForumHeaderClientProps) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [announcementDialogOpen, setAnnouncementDialogOpen] = useState(false);

	const handleNewThreadClick = async () => {
		// Unified write-gate preflight: checks email verification AND posting
		// restrictions (registration days, avatar, etc.) before opening the editor.
		// This avoids a confusing flow where the user fills out a thread and only
		// learns at submit time that they can't post. The server-side guards
		// (withVerifiedEmail + checkPostingPermission) still backstop at write time.
		if (await writeGatePreflight(selfEmailVerifiedAt, "thread")) return;
		setDialogOpen(true);
	};

	return (
		<>
			<ForumPageHeader
				icon={<Hash />}
				title={forum.name}
				description={
					forum.description ? (
						<SafeHtml html={forum.description} />
					) : (
						"浏览最新讨论，分享你的想法与见闻。"
					)
				}
				actions={
					<>
						{canEditAnnouncement && !forum.announcement && (
							<Button variant="outline" onClick={() => setAnnouncementDialogOpen(true)}>
								<Megaphone className="size-4" aria-hidden="true" />
								添加公告
							</Button>
						)}
						{!isGroup && (
							<Button onClick={handleNewThreadClick}>
								<PenLine className="size-4" aria-hidden="true" />
								发表新帖
							</Button>
						)}
					</>
				}
			>
				{!isGroup && (
					<div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground tabular-nums">
						<span>
							主题{" "}
							<strong className="ml-1 text-base font-semibold text-foreground">
								{formatNumber(forum.threads)}
							</strong>
						</span>
						<span>
							帖子{" "}
							<strong className="ml-1 text-base font-semibold text-foreground">
								{formatNumber(forum.posts)}
							</strong>
						</span>
						<span>
							今日主题{" "}
							<strong className="ml-1 text-base font-semibold text-primary">
								{formatNumber(forum.todayThreads)}
							</strong>
						</span>
						<Link
							href="/digest"
							className="ml-auto inline-flex items-center gap-1.5 text-primary hover:underline"
						>
							<Award className="size-4" aria-hidden="true" />
							精华帖
						</Link>
					</div>
				)}
				<AnnouncementCard
					forumId={forum.id}
					forumName={forum.name}
					announcement={forum.announcement}
					canEdit={canEditAnnouncement}
				/>
			</ForumPageHeader>

			{/* New Thread Dialog */}
			<NewThreadDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				forumId={forum.id}
				forumName={forum.name}
				threadTypes={threadTypes}
			/>

			{/* Announcement edit dialog for the empty-state entry. The
			    populated card embeds its own dialog instance so the two
			    don't share state. */}
			{canEditAnnouncement && !forum.announcement && (
				<AnnouncementEditDialog
					open={announcementDialogOpen}
					onOpenChange={setAnnouncementDialogOpen}
					forumId={forum.id}
					forumName={forum.name}
					initialAnnouncement=""
				/>
			)}
		</>
	);
}
