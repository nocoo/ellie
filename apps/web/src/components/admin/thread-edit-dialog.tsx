"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Thread, ThreadUpdate } from "@/viewmodels/admin/threads";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThreadEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	thread: Thread | null;
	loading?: boolean;
	onSave: (id: number, data: ThreadUpdate) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ThreadEditDialog({
	open,
	onOpenChange,
	thread,
	loading = false,
	onSave,
}: ThreadEditDialogProps) {
	const [subject, setSubject] = useState("");
	const [sticky, setSticky] = useState(0);
	const [digest, setDigest] = useState(0);
	const [closed, setClosed] = useState(0);
	const [highlight, setHighlight] = useState(0);

	useEffect(() => {
		if (thread) {
			setSubject(thread.subject);
			setSticky(thread.sticky);
			setDigest(thread.digest);
			setClosed(thread.closed);
			setHighlight(thread.highlight);
		}
	}, [thread]);

	const handleSave = useCallback(() => {
		if (!thread || loading) return;
		onSave(thread.id, { subject, sticky, digest, closed, highlight });
	}, [thread, loading, onSave, subject, sticky, digest, closed, highlight]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Edit Thread</DialogTitle>
				</DialogHeader>

				<div className="grid gap-4 py-4">
					<div className="grid gap-2">
						<Label htmlFor="edit-subject">Subject</Label>
						<Input
							id="edit-subject"
							value={subject}
							onChange={(e) => setSubject(e.target.value)}
							maxLength={200}
						/>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="edit-sticky">Sticky</Label>
							<select
								id="edit-sticky"
								value={sticky}
								onChange={(e) => setSticky(Number(e.target.value))}
								className="h-9 rounded-md border border-input bg-background px-3 text-sm"
							>
								<option value={0}>None</option>
								<option value={1}>Forum Sticky</option>
								<option value={2}>Global Sticky</option>
								<option value={3}>Super Sticky</option>
							</select>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="edit-digest">Digest</Label>
							<select
								id="edit-digest"
								value={digest}
								onChange={(e) => setDigest(Number(e.target.value))}
								className="h-9 rounded-md border border-input bg-background px-3 text-sm"
							>
								<option value={0}>None</option>
								<option value={1}>Digest I</option>
								<option value={2}>Digest II</option>
								<option value={3}>Digest III</option>
							</select>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="edit-closed">Closed</Label>
							<select
								id="edit-closed"
								value={closed}
								onChange={(e) => setClosed(Number(e.target.value))}
								className="h-9 rounded-md border border-input bg-background px-3 text-sm"
							>
								<option value={0}>Open</option>
								<option value={1}>Closed</option>
							</select>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="edit-highlight">Highlight</Label>
							<Input
								id="edit-highlight"
								type="number"
								value={highlight}
								onChange={(e) => setHighlight(Number(e.target.value))}
								min={0}
							/>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={loading}>
						{loading ? "Saving..." : "Save Changes"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
