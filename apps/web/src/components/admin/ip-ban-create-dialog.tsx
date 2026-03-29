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
import type { IpBan, IpBanCreate, IpBanUpdate } from "@/viewmodels/admin/ip-bans";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IpBanCreateDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** When provided, the dialog is in edit mode. */
	ipBan?: IpBan | null;
	loading?: boolean;
	onCreate?: (data: IpBanCreate) => void;
	onUpdate?: (id: number, data: IpBanUpdate) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert an ISO datetime string to the `datetime-local` input value format. */
function toDatetimeLocal(iso: string | null): string {
	if (!iso) return "";
	const d = new Date(iso);
	// yyyy-MM-ddTHH:mm
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IpBanCreateDialog({
	open,
	onOpenChange,
	ipBan = null,
	loading = false,
	onCreate,
	onUpdate,
}: IpBanCreateDialogProps) {
	const isEdit = ipBan !== null;

	const [ip, setIp] = useState("");
	const [reason, setReason] = useState("");
	const [expiresAt, setExpiresAt] = useState("");

	// Sync form when ipBan changes (edit mode)
	useEffect(() => {
		if (ipBan) {
			setIp(ipBan.ip);
			setReason(ipBan.reason ?? "");
			setExpiresAt(toDatetimeLocal(ipBan.expiresAt));
		} else {
			setIp("");
			setReason("");
			setExpiresAt("");
		}
	}, [ipBan]);

	const handleSave = useCallback(() => {
		if (loading) return;
		if (isEdit && ipBan && onUpdate) {
			const data: IpBanUpdate = { ip, reason: reason || undefined };
			data.expiresAt = expiresAt ? new Date(expiresAt).toISOString() : null;
			onUpdate(ipBan.id, data);
		} else if (onCreate) {
			const data: IpBanCreate = { ip };
			if (reason) data.reason = reason;
			if (expiresAt) data.expiresAt = new Date(expiresAt).toISOString();
			onCreate(data);
		}
	}, [loading, isEdit, ipBan, ip, reason, expiresAt, onCreate, onUpdate]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{isEdit ? "Edit IP Ban" : "Create IP Ban"}</DialogTitle>
				</DialogHeader>

				<div className="grid gap-4 py-4">
					<div className="grid gap-2">
						<Label htmlFor="ipban-ip">IP / Range</Label>
						<Input
							id="ipban-ip"
							value={ip}
							onChange={(e) => setIp(e.target.value)}
							placeholder="192.168.1.1 or 10.0.0.0/24"
							required
						/>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="ipban-reason">Reason</Label>
						<textarea
							id="ipban-reason"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							placeholder="Optional reason for the ban"
							rows={3}
							className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="ipban-expires">Expires At</Label>
						<Input
							id="ipban-expires"
							type="datetime-local"
							value={expiresAt}
							onChange={(e) => setExpiresAt(e.target.value)}
						/>
						<p className="text-xs text-muted-foreground">Leave empty for a permanent ban.</p>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={loading || !ip.trim()}>
						{loading ? "Saving..." : isEdit ? "Save Changes" : "Create Ban"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
