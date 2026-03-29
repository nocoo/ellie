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
import type { User, UserUpdate } from "@/viewmodels/admin/users";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	user: User | null;
	loading?: boolean;
	onSave: (id: number, data: UserUpdate) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
	{ value: 0, label: "Active" },
	{ value: -1, label: "Banned" },
	{ value: -2, label: "Archived" },
];

const ROLE_OPTIONS = [
	{ value: 0, label: "Member" },
	{ value: 1, label: "Admin" },
	{ value: 2, label: "SuperMod" },
	{ value: 3, label: "Mod" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UserEditDialog({
	open,
	onOpenChange,
	user,
	loading = false,
	onSave,
}: UserEditDialogProps) {
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [avatar, setAvatar] = useState("");
	const [status, setStatus] = useState(0);
	const [role, setRole] = useState(0);
	const [credits, setCredits] = useState(0);

	// Sync form when user changes
	useEffect(() => {
		if (user) {
			setUsername(user.username);
			setEmail(user.email);
			setAvatar(user.avatar);
			setStatus(user.status);
			setRole(user.role);
			setCredits(user.credits);
		}
	}, [user]);

	const handleSave = useCallback(() => {
		if (!user || loading) return;
		onSave(user.uid, {
			username,
			email,
			avatar,
			status,
			role,
			credits,
		});
	}, [user, loading, onSave, username, email, avatar, status, role, credits]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Edit User</DialogTitle>
				</DialogHeader>

				<div className="grid gap-4 py-4">
					<div className="grid gap-2">
						<Label htmlFor="edit-username">Username</Label>
						<Input
							id="edit-username"
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							maxLength={50}
						/>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="edit-email">Email</Label>
						<Input
							id="edit-email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							maxLength={255}
						/>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="edit-avatar">Avatar URL</Label>
						<Input
							id="edit-avatar"
							value={avatar}
							onChange={(e) => setAvatar(e.target.value)}
							placeholder="https://..."
						/>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="edit-status">Status</Label>
							<select
								id="edit-status"
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

						<div className="grid gap-2">
							<Label htmlFor="edit-role">Role</Label>
							<select
								id="edit-role"
								value={role}
								onChange={(e) => setRole(Number(e.target.value))}
								className="h-9 rounded-md border border-input bg-background px-3 text-sm"
							>
								{ROLE_OPTIONS.map((opt) => (
									<option key={opt.value} value={opt.value}>
										{opt.label}
									</option>
								))}
							</select>
						</div>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="edit-credits">Credits</Label>
						<Input
							id="edit-credits"
							type="number"
							value={credits}
							onChange={(e) => setCredits(Number(e.target.value))}
						/>
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
