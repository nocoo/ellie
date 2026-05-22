"use client";

// Client wrapper for forum page header with new thread button
// Manages new thread dialog state. Phase 7-4: optionally short-circuits
// the dialog open with a §5.4 preflight when the parent server page can
// reliably tell us the user is unverified — see `selfEmailVerifiedAt`.

import { AnnouncementCard } from "@/components/forum/announcement-card";
import { AnnouncementEditDialog } from "@/components/forum/announcement-edit-dialog";
import { NewThreadDialog } from "@/components/forum/new-thread-dialog";
import { SafeHtml } from "@/components/forum/safe-html";
import { Button } from "@/components/ui/button";
import type { ForumThreadTypesPublic } from "@/viewmodels/forum/thread-types";
import { writeGatePreflight } from "@/viewmodels/forum/write-gate";
import { formatNumber } from "@/viewmodels/shared/formatting";
import type { Forum } from "@ellie/types";
import { Award, Megaphone, PenLine } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

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
			<div className="rounded-sm border border-border bg-gradient-to-br from-primary/5 via-background to-primary/[0.02]">
				<div className="p-4">
					{/* Top: Forum name + action buttons */}
					<div className="flex items-center justify-between gap-4">
						<h1 className="text-lg font-semibold text-foreground">{forum.name}</h1>
						<div className="flex items-center gap-2 shrink-0">
							{/* Empty-state announcement creation entry — only when
							    moderator AND there is no announcement yet. Non-empty
							    state owns its own edit button inside the card. */}
							{canEditAnnouncement && !forum.announcement && (
								<Button
									variant="outline"
									size="sm"
									onClick={() => setAnnouncementDialogOpen(true)}
									className="gap-1.5"
								>
									<Megaphone className="h-4 w-4" />
									添加公告
								</Button>
							)}
							{!isGroup && (
								<Button
									onClick={handleNewThreadClick}
									className="gap-2 bg-primary hover:bg-primary/90"
								>
									<PenLine className="h-4 w-4" />
									发表新帖
								</Button>
							)}
						</div>
					</div>

					{/* Description */}
					{forum.description && (
						<SafeHtml
							html={forum.description}
							className="mt-2 text-sm text-muted-foreground leading-relaxed"
						/>
					)}

					{/* Announcement card (populated state) */}
					<AnnouncementCard
						forumId={forum.id}
						forumName={forum.name}
						announcement={forum.announcement}
						canEdit={canEditAnnouncement}
					/>

					{/* Stats row */}
					{!isGroup && (
						<div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-6 text-sm">
							<span className="text-muted-foreground">
								主题{" "}
								<span className="font-medium text-foreground">{formatNumber(forum.threads)}</span>
							</span>
							<span className="text-muted-foreground">
								回帖{" "}
								<span className="font-medium text-foreground">{formatNumber(forum.posts)}</span>
							</span>
							<Button
								size="sm"
								className="bg-success hover:bg-success/90 text-white gap-1.5"
								nativeButton={false}
								render={<Link href="/digest" />}
							>
								<Award className="h-4 w-4" />
								精华帖
							</Button>
						</div>
					)}
				</div>
			</div>

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
