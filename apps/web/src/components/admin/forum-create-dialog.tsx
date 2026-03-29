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
import type { ForumCreate } from "@/viewmodels/admin/forums";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForumCreateDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	loading?: boolean;
	onSave: (data: ForumCreate) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
	{ value: 0, label: "Active" },
	{ value: -1, label: "Hidden" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ForumCreateDialog({
	open,
	onOpenChange,
	loading = false,
	onSave,
}: ForumCreateDialogProps) {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [order, setOrder] = useState(0);
	const [status, setStatus] = useState(0);

	// Reset form when dialog opens
	useEffect(() => {
		if (open) {
			setName("");
			setDescription("");
			setOrder(0);
			setStatus(0);
		}
	}, [open]);

	const handleSave = useCallback(() => {
		if (!name.trim() || loading) return;
		onSave({ name: name.trim(), description: description.trim(), order, status });
	}, [name, description, order, status, loading, onSave]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Create Forum</DialogTitle>
				</DialogHeader>

				<div className="grid gap-4 py-4">
					<div className="grid gap-2">
						<Label htmlFor="create-name">Name</Label>
						<Input
							id="create-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							maxLength={100}
							placeholder="Forum name"
						/>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="create-description">Description</Label>
						<textarea
							id="create-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							className="min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							placeholder="Forum description"
							maxLength={500}
						/>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="create-order">Order</Label>
							<Input
								id="create-order"
								type="number"
								value={order}
								onChange={(e) => setOrder(Number(e.target.value))}
								min={0}
							/>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="create-status">Status</Label>
							<select
								id="create-status"
								value={status}
								onChange={(e) => setStatus(Number(e.target.value))}
								className="h-9 rounded-md border border-input bg-background px-3 text-sm"
							>
								{STATUS_OPTIONS.map((opt) => (
									<option key={opt.value} value={opt.value}>
										{opt.label}
									</option>
								))}
							</select>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={!name.trim() || loading}>
						{loading ? "Creating..." : "Create Forum"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
