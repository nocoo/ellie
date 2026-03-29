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
import type {
	CensorWord,
	CensorWordCreate,
	CensorWordUpdate,
} from "@/viewmodels/admin/censor-words";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CensorWordCreateDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** When non-null the dialog is in "edit" mode. */
	censorWord: CensorWord | null;
	loading?: boolean;
	onSave: (data: CensorWordCreate) => void;
	onUpdate: (id: number, data: CensorWordUpdate) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CensorWordCreateDialog({
	open,
	onOpenChange,
	censorWord,
	loading = false,
	onSave,
	onUpdate,
}: CensorWordCreateDialogProps) {
	const [find, setFind] = useState("");
	const [replacement, setReplacement] = useState("");
	const [action, setAction] = useState<"ban" | "replace">("replace");

	const isEdit = censorWord !== null;

	useEffect(() => {
		if (censorWord) {
			setFind(censorWord.find);
			setReplacement(censorWord.replacement);
			setAction(censorWord.action);
		} else {
			setFind("");
			setReplacement("");
			setAction("replace");
		}
	}, [censorWord]);

	const handleSave = useCallback(() => {
		if (loading || !find.trim()) return;
		if (isEdit && censorWord) {
			onUpdate(censorWord.id, {
				find: find.trim(),
				replacement: replacement.trim() || undefined,
				action,
			});
		} else {
			onSave({
				find: find.trim(),
				replacement: replacement.trim() || undefined,
				action,
			});
		}
	}, [loading, find, replacement, action, isEdit, censorWord, onSave, onUpdate]);

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (!nextOpen) {
				setFind("");
				setReplacement("");
				setAction("replace");
			}
			onOpenChange(nextOpen);
		},
		[onOpenChange],
	);

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{isEdit ? "Edit Censor Word" : "Add Censor Word"}</DialogTitle>
				</DialogHeader>

				<div className="grid gap-4 py-4">
					<div className="grid gap-2">
						<Label htmlFor="cw-find">Word / Pattern</Label>
						<Input
							id="cw-find"
							value={find}
							onChange={(e) => setFind(e.target.value)}
							placeholder="Enter word to censor"
							maxLength={200}
						/>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="cw-action">Action</Label>
						<select
							id="cw-action"
							value={action}
							onChange={(e) => setAction(e.target.value as "ban" | "replace")}
							className="h-9 rounded-md border border-input bg-background px-3 text-sm"
						>
							<option value="replace">Replace</option>
							<option value="ban">Ban</option>
						</select>
						<p className="text-xs text-muted-foreground">
							Replace: swap the word with the replacement. Ban: block the post entirely.
						</p>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="cw-replacement">Replacement</Label>
						<Input
							id="cw-replacement"
							value={replacement}
							onChange={(e) => setReplacement(e.target.value)}
							placeholder="** (default)"
							maxLength={200}
							disabled={action === "ban"}
						/>
						<p className="text-xs text-muted-foreground">
							{action === "ban"
								? "Not applicable when action is Ban."
								: "Leave empty to use the default replacement (**)."}
						</p>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={loading || !find.trim()}>
						{loading ? "Saving..." : isEdit ? "Save Changes" : "Add Word"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
