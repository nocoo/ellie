"use client";

import type { IpBan, IpBanCreate, IpBanUpdate } from "@/viewmodels/admin/ip-bans";
import { Button } from "@ellie/ui";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@ellie/ui";
import { Input } from "@ellie/ui";
import { Label } from "@ellie/ui";
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

/** Convert a Unix timestamp (seconds) to the `datetime-local` input value format. */
function toDatetimeLocal(ts: number | null): string {
	if (!ts) return "";
	const d = new Date(ts * 1000);
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
			const data: IpBanUpdate = { reason: reason || undefined };
			data.expiresAt = expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : null;
			onUpdate(ipBan.id, data);
		} else if (onCreate) {
			const data: IpBanCreate = { ip };
			if (reason) data.reason = reason;
			if (expiresAt) data.expiresAt = Math.floor(new Date(expiresAt).getTime() / 1000);
			onCreate(data);
		}
	}, [loading, isEdit, ipBan, ip, reason, expiresAt, onCreate, onUpdate]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{isEdit ? "编辑 IP 封禁" : "创建 IP 封禁"}</DialogTitle>
				</DialogHeader>

				<div className="grid gap-4 py-4">
					<div className="grid gap-2">
						<Label htmlFor="ipban-ip">IP / 范围</Label>
						<Input
							id="ipban-ip"
							value={ip}
							onChange={(e) => setIp(e.target.value)}
							placeholder="如 192.168.1.1 或 10.0.0.0/24"
							required
						/>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="ipban-reason">原因</Label>
						<textarea
							id="ipban-reason"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							placeholder="封禁原因（选填）"
							rows={3}
							className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="ipban-expires">过期时间</Label>
						<Input
							id="ipban-expires"
							type="datetime-local"
							value={expiresAt}
							onChange={(e) => setExpiresAt(e.target.value)}
						/>
						<p className="text-xs text-muted-foreground">留空表示永久封禁。</p>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						取消
					</Button>
					<Button onClick={handleSave} disabled={loading || !ip.trim()}>
						{loading ? "保存中..." : isEdit ? "保存更改" : "创建封禁"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
