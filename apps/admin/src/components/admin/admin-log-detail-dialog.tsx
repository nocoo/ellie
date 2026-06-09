"use client";

import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ellie/ui";
import Link from "next/link";
import { IpLookupInline } from "@/components/admin/ip-lookup-inline";
import {
	type AdminLog,
	formatLogTime,
	formatTarget,
	parseDetails,
	targetHref,
} from "@/viewmodels/admin/admin-logs";
import { ADMIN_WIDE_DIALOG_BODY_CLASS, ADMIN_WIDE_DIALOG_CONTENT_CLASS } from "./dialog-presets";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AdminLogDetailDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	log: AdminLog | null;
}

// ---------------------------------------------------------------------------
// Component — read-only. No mutations, no actions besides close.
// ---------------------------------------------------------------------------

export function AdminLogDetailDialog({ open, onOpenChange, log }: AdminLogDetailDialogProps) {
	const parsed = log ? parseDetails(log.details) : null;
	const href = log ? targetHref(log.targetType, log.targetId) : null;
	const targetText = log ? formatTarget(log.targetType, log.targetId) : "";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={ADMIN_WIDE_DIALOG_CONTENT_CLASS}>
				<DialogHeader className="min-w-0">
					<DialogTitle>操作日志详情</DialogTitle>
					<DialogDescription>只读审计记录</DialogDescription>
				</DialogHeader>

				{log && (
					<div className={`${ADMIN_WIDE_DIALOG_BODY_CLASS} grid gap-3 py-2 text-sm`}>
						<DetailRow label="ID" value={String(log.id)} />
						<DetailRow label="时间" value={formatLogTime(log.createdAt)} />
						<DetailRow
							label="管理员"
							value={
								log.adminId > 0 ? (
									<Link
										href={`/admin/users/${log.adminId}`}
										className="text-primary underline-offset-4 hover:underline"
									>
										{log.adminName || "(未命名)"} #{log.adminId}
									</Link>
								) : (
									<span>
										{log.adminName || "(未命名)"} #{log.adminId}
									</span>
								)
							}
						/>
						<DetailRow
							label="Action"
							value={<code className="rounded bg-secondary px-1.5 py-0.5">{log.action}</code>}
						/>
						<DetailRow
							label="目标"
							value={
								href ? (
									<Link
										href={href}
										className="text-primary underline-offset-4 hover:underline"
										data-testid="admin-log-target-link"
									>
										{targetText}
									</Link>
								) : (
									<span data-testid="admin-log-target-text">{targetText || "—"}</span>
								)
							}
						/>
						<DetailRow
							label="IP"
							value={
								<div>
									<span className="font-mono">{log.ip || "—"}</span>
									{log.ip && <IpLookupInline ip={log.ip} />}
								</div>
							}
						/>

						<div className="grid gap-1.5">
							<span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
								Details
								{parsed && !parsed.ok && (
									<span className="ml-2 normal-case text-amber-600 dark:text-amber-400">
										(原始文本，非 JSON)
									</span>
								)}
							</span>
							<pre
								data-testid="admin-log-details"
								className="max-h-80 overflow-auto rounded-md bg-secondary p-3 text-xs leading-relaxed whitespace-pre-wrap break-words"
							>
								{renderDetails(parsed)}
							</pre>
						</div>
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						关闭
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="grid grid-cols-[80px_1fr] items-baseline gap-3">
			<span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
				{label}
			</span>
			<span className="min-w-0 break-words">{value}</span>
		</div>
	);
}

function renderDetails(parsed: ReturnType<typeof parseDetails> | null): string {
	if (!parsed) return "";
	if (parsed.ok) {
		try {
			return JSON.stringify(parsed.value, null, 2);
		} catch {
			return String(parsed.value);
		}
	}
	return parsed.raw === "" ? "(无)" : parsed.raw;
}
