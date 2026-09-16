"use client";

import {
	Button,
	Dialog,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
} from "@nocoo/basalt";
import { InputArea } from "@nocoo/basalt/components/input-area";
import { Save, ShieldBan } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AdminDialogContent } from "@/components/admin/admin-dialog-content";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import type { IpBan, IpBanCreate, IpBanUpdate } from "@/viewmodels/admin/ip-bans";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IpBanCreateDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** When provided, the dialog is in edit mode. */
	ipBan?: IpBan | null;
	loading?: boolean;
	error?: string | null;
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
	error,
	onCreate,
	onUpdate,
}: IpBanCreateDialogProps) {
	const isEdit = ipBan !== null;

	const [ip, setIp] = useState("");
	const [reason, setReason] = useState("");
	const [expiresAt, setExpiresAt] = useState("");

	// Sync form when ipBan changes (edit mode)
	useEffect(() => {
		if (!open) return;
		if (ipBan) {
			setIp(ipBan.ip);
			setReason(ipBan.reason ?? "");
			setExpiresAt(toDatetimeLocal(ipBan.expiresAt));
		} else {
			setIp("");
			setReason("");
			setExpiresAt("");
		}
	}, [open, ipBan]);

	const handleSave = useCallback(() => {
		if (loading) return;
		if (isEdit && ipBan && onUpdate) {
			const data: IpBanUpdate = { reason };
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
		<Dialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
			<AdminDialogContent
				size="lg"
				aria-describedby={undefined}
				closeDisabled={loading}
				className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0"
			>
				<DialogHeader className="shrink-0 border-b border-basalt-border/50 px-5 py-4 pr-12">
					<DialogTitle className="flex items-center gap-2 text-base">
						<ShieldBan aria-hidden="true" className="h-4 w-4 shrink-0 text-basalt-primary" />
						{isEdit ? "编辑 IP 封禁" : "创建 IP 封禁"}
					</DialogTitle>
				</DialogHeader>

				{error && <AdminInlineMessage variant="error" text={error} dense className="mx-5 mt-3" />}
				<div className="min-h-0 overflow-y-auto px-5 py-4">
					<fieldset disabled={loading} className="grid min-w-0 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="ipban-ip">IP / 范围</Label>
							<Input
								id="ipban-ip"
								readOnly={isEdit}
								className="font-mono"
								value={ip}
								onChange={(e) => setIp(e.target.value)}
								placeholder="如 192.168.1.1 或 10.0.0.0/24"
								required
							/>
							{isEdit && (
								<p className="text-xs text-basalt-muted-foreground">
									已有规则的 IP 不可修改，可调整原因与过期时间。
								</p>
							)}
						</div>

						<div className="grid gap-2">
							<Label htmlFor="ipban-reason">原因</Label>
							<InputArea
								id="ipban-reason"
								value={reason}
								onChange={(e) => setReason(e.target.value)}
								placeholder="封禁原因（选填）"
								rows={3}
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
							<p className="text-xs text-basalt-muted-foreground">留空表示永久封禁。</p>
						</div>
					</fieldset>
				</div>

				<DialogFooter className="m-0 shrink-0 border-t border-basalt-border/50 px-5 py-3">
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						取消
					</Button>
					<Button onClick={handleSave} disabled={loading || !ip.trim()}>
						<Save aria-hidden="true" className="mr-2 h-4 w-4" />
						{loading ? "保存中..." : isEdit ? "保存更改" : "创建封禁"}
					</Button>
				</DialogFooter>
			</AdminDialogContent>
		</Dialog>
	);
}
