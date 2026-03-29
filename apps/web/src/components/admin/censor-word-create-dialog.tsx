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
import type { CensorWord, CensorWordUpdate } from "@/viewmodels/admin/censor-words";
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
	onSave: (data: { word: string; replacement?: string }) => void;
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
	const [word, setWord] = useState("");
	const [replacement, setReplacement] = useState("");

	const isEdit = censorWord !== null;

	useEffect(() => {
		if (censorWord) {
			setWord(censorWord.word);
			setReplacement(censorWord.replacement);
		} else {
			setWord("");
			setReplacement("");
		}
	}, [censorWord]);

	const handleSave = useCallback(() => {
		if (loading || !word.trim()) return;
		if (isEdit && censorWord) {
			onUpdate(censorWord.id, {
				word: word.trim(),
				replacement: replacement.trim() || undefined,
			});
		} else {
			onSave({
				word: word.trim(),
				replacement: replacement.trim() || undefined,
			});
		}
	}, [loading, word, replacement, isEdit, censorWord, onSave, onUpdate]);

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (!nextOpen) {
				setWord("");
				setReplacement("");
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
						<Label htmlFor="cw-word">Word</Label>
						<Input
							id="cw-word"
							value={word}
							onChange={(e) => setWord(e.target.value)}
							placeholder="Enter word to censor"
							maxLength={200}
						/>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="cw-replacement">Replacement</Label>
						<Input
							id="cw-replacement"
							value={replacement}
							onChange={(e) => setReplacement(e.target.value)}
							placeholder="*** (default)"
							maxLength={200}
						/>
						<p className="text-xs text-muted-foreground">
							Leave empty to use the default replacement (***).
						</p>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={loading || !word.trim()}>
						{loading ? "Saving..." : isEdit ? "Save Changes" : "Add Word"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
