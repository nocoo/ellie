"use client";

// Client wrapper for forum page header with new thread button
// Manages new thread dialog state. Phase 7-4: optionally short-circuits
// the dialog open with a §5.4 preflight when the parent server page can
// reliably tell us the user is unverified — see `selfEmailVerifiedAt`.

import { NewThreadDialog } from "@/components/forum/new-thread-dialog";
import { SafeHtml } from "@/components/forum/safe-html";
import { Button } from "@/components/ui/button";
import { preflightEmailVerifiedBlock } from "@/viewmodels/forum/email-not-verified-dispatch";
import { formatNumber } from "@/viewmodels/shared/formatting";
import type { Forum } from "@ellie/types";
import { Award, PenLine } from "lucide-react";
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
}

export function ForumHeaderClient({ forum, isGroup, selfEmailVerifiedAt }: ForumHeaderClientProps) {
	const [dialogOpen, setDialogOpen] = useState(false);

	const handleNewThreadClick = () => {
		// Preflight: if the user is unverified, fire the §5.4 dialog event
		// and DO NOT open the editor. This avoids a confusing flow where
		// the user fills out a thread and only learns at submit time that
		// it can't post. The api-client interceptor still backstops if the
		// server sees a different state at write time.
		if (preflightEmailVerifiedBlock(selfEmailVerifiedAt)) return;
		setDialogOpen(true);
	};

	return (
		<>
			<div className="rounded-sm border border-border bg-gradient-to-br from-primary/5 via-background to-primary/[0.02]">
				<div className="p-4">
					{/* Top: Forum name + New thread button */}
					<div className="flex items-center justify-between gap-4">
						<h1 className="text-lg font-semibold text-foreground">{forum.name}</h1>
						{!isGroup && (
							<Button
								onClick={handleNewThreadClick}
								className="shrink-0 gap-2 bg-primary hover:bg-primary/90"
							>
								<PenLine className="h-4 w-4" />
								发表新帖
							</Button>
						)}
					</div>

					{/* Description */}
					{forum.description && (
						<SafeHtml
							html={forum.description}
							className="mt-2 text-sm text-muted-foreground leading-relaxed"
						/>
					)}

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
			/>
		</>
	);
}
