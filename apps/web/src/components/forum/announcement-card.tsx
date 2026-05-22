"use client";

// AnnouncementCard — read-only display surface for a forum's
// announcement, with an inline edit affordance for moderators.
//
// Visibility matrix:
//   announcement | canEdit | rendered output
//   ------------ | ------- | ----------------------------------------
//   empty        | false   | nothing (anonymous / regular user, empty)
//   empty        | true    | nothing here — edit entry lives in the
//                          | header (see forum-header-client). Card
//                          | only owns the populated-state surface.
//   non-empty    | false   | content card without edit button
//   non-empty    | true    | content card with small edit icon button
//
// The edit button opens `AnnouncementEditDialog`. State for the dialog
// is owned here so the header doesn't have to thread it through.

import { Button } from "@/components/ui/button";
import { Megaphone, PenLine } from "lucide-react";
import { useState } from "react";
import { AnnouncementEditDialog } from "./announcement-edit-dialog";
import { SafeRichHtml } from "./safe-rich-html";

interface AnnouncementCardProps {
	forumId: number;
	forumName: string;
	announcement: string;
	canEdit: boolean;
}

export function AnnouncementCard({
	forumId,
	forumName,
	announcement,
	canEdit,
}: AnnouncementCardProps) {
	const [editing, setEditing] = useState(false);

	if (!announcement) return null;

	return (
		<>
			<div className="mt-3 rounded-sm border border-border bg-card/60 p-3">
				<div className="flex items-start justify-between gap-3">
					<div className="flex items-center gap-2 text-sm font-medium text-foreground">
						<Megaphone className="h-4 w-4 text-primary" />
						公告
					</div>
					{canEdit && (
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => setEditing(true)}
							className="text-muted-foreground hover:text-foreground"
							aria-label="编辑公告"
						>
							<PenLine className="h-4 w-4" />
						</Button>
					)}
				</div>
				<SafeRichHtml
					html={announcement}
					className="mt-2 text-sm text-foreground/90 leading-relaxed"
				/>
			</div>
			{canEdit && (
				<AnnouncementEditDialog
					open={editing}
					onOpenChange={setEditing}
					forumId={forumId}
					forumName={forumName}
					initialAnnouncement={announcement}
				/>
			)}
		</>
	);
}
