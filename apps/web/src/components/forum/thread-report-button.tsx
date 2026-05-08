"use client";

// components/forum/thread-report-button.tsx — User-facing "举报主题" entry on thread header.
// Distinct from first-post (回帖) report; targets the thread itself.

import { ReportDialog } from "@/components/forum/report-dialog";
import { Button } from "@/components/ui/button";
import { Flag } from "lucide-react";
import { useState } from "react";

interface ThreadReportButtonProps {
	threadId: number;
	authorId: number;
	currentUserId: number | null;
}

export function ThreadReportButton({ threadId, authorId, currentUserId }: ThreadReportButtonProps) {
	const [open, setOpen] = useState(false);

	// UI hides self-report and anonymous entries; Worker remains the final guard.
	if (currentUserId === null || currentUserId === authorId) {
		return null;
	}

	return (
		<>
			<Button
				variant="ghost"
				size="sm"
				className="gap-1 text-muted-foreground hover:text-destructive"
				aria-label="举报主题"
				onClick={() => setOpen(true)}
			>
				<Flag className="h-3.5 w-3.5" />
				<span className="hidden sm:inline">举报主题</span>
			</Button>
			<ReportDialog open={open} onOpenChange={setOpen} targetType="thread" targetId={threadId} />
		</>
	);
}
