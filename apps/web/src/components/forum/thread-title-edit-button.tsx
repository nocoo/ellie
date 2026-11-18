"use client";

// components/forum/thread-title-edit-button.tsx — Pencil entry next to the
// thread title <h1>. PC-only (`hidden sm:inline-flex`) per design freeze
// msg=a8ee78db. Mounting the dialog state is the only reason this needs to
// be a client component — the dialog itself owns submit/error wiring.

import { Button } from "@nocoo/basalt/components/button";
import { Pencil } from "@nocoo/basalt/icons";
import { useState } from "react";
import { ThreadTitleEditDialog } from "@/components/forum/thread-title-edit-dialog";

interface ThreadTitleEditButtonProps {
	threadId: number;
	currentSubject: string;
}

export function ThreadTitleEditButton({ threadId, currentSubject }: ThreadTitleEditButtonProps) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				aria-label="编辑主题标题"
				title="编辑标题"
				className="hidden sm:inline-flex shrink-0 text-basalt-muted-foreground hover:text-basalt-primary"
				onClick={() => setOpen(true)}
			>
				<Pencil className="h-4 w-4" />
			</Button>
			<ThreadTitleEditDialog
				open={open}
				onOpenChange={setOpen}
				threadId={threadId}
				currentSubject={currentSubject}
			/>
		</>
	);
}
