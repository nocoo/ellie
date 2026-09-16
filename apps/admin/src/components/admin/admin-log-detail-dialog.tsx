"use client";

import {
	Button,
	DescriptionList,
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nocoo/basalt";
import { Code, CodeBlock } from "@nocoo/basalt/components/code";
import { ScrollText } from "lucide-react";
import Link from "next/link";
import { AdminDialogContent } from "@/components/admin/admin-dialog-content";
import { IpLookupInline } from "@/components/admin/ip-lookup-inline";
import {
	type AdminLog,
	adminLogActorKey,
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
	const actorKey = log ? adminLogActorKey(log) : null;
	const actorEmail = actorKey?.startsWith("email:") ? actorKey.slice(6) : null;
	const href = log ? targetHref(log.targetType, log.targetId) : null;
	const targetText = log ? formatTarget(log.targetType, log.targetId) : "";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<AdminDialogContent className={ADMIN_WIDE_DIALOG_CONTENT_CLASS}>
				<DialogHeader className="min-w-0 shrink-0 pr-8">
					<DialogTitle className="flex items-center gap-2 text-base">
						<ScrollText aria-hidden="true" className="h-4 w-4 text-basalt-primary" />
						操作日志详情
					</DialogTitle>
					<DialogDescription className="text-xs">
						只读审计记录 · {log ? `#${log.id}` : ""}
					</DialogDescription>
				</DialogHeader>

				{log && (
					<div className={`${ADMIN_WIDE_DIALOG_BODY_CLASS} grid gap-3 py-2 text-sm`}>
						<DescriptionList columns={2}>
							<DescriptionList.Item term="ID">{log.id}</DescriptionList.Item>
							<DescriptionList.Item term="时间">
								{formatLogTime(log.createdAt)}
							</DescriptionList.Item>
							<DescriptionList.Item term="管理员">
								{actorEmail ? (
									<span className="break-all">{actorEmail}</span>
								) : log.adminId > 0 ? (
									<Link
										href={`/admin/users/${log.adminId}`}
										className="break-all text-basalt-primary underline-offset-4 hover:underline"
									>
										{log.adminName || "(未命名)"} #{log.adminId}
									</Link>
								) : (
									<span>{log.adminName || "未记录"}</span>
								)}
							</DescriptionList.Item>
							<DescriptionList.Item term="操作">
								<Code className="break-all">{log.action}</Code>
							</DescriptionList.Item>
							<DescriptionList.Item term="目标">
								{href ? (
									<Link
										href={href}
										className="break-all text-basalt-primary underline-offset-4 hover:underline"
										data-testid="admin-log-target-link"
									>
										{targetText}
									</Link>
								) : (
									<span data-testid="admin-log-target-text">{targetText || "—"}</span>
								)}
							</DescriptionList.Item>
							<DescriptionList.Item term="IP">
								<div className="flex flex-wrap items-center gap-1">
									<span className="break-all font-mono">{log.ip || "—"}</span>
									{log.ip && <IpLookupInline ip={log.ip} />}
								</div>
							</DescriptionList.Item>
						</DescriptionList>

						<div className="grid gap-1.5">
							<span className="text-xs font-medium uppercase tracking-wider text-basalt-muted-foreground">
								详细记录
								{parsed && !parsed.ok && (
									<span className="ml-2 normal-case text-basalt-warning">(原始文本，非 JSON)</span>
								)}
							</span>
							<CodeBlock
								data-testid="admin-log-details"
								className="max-h-80 overflow-auto p-3 text-xs leading-relaxed whitespace-pre-wrap break-words"
							>
								{renderDetails(parsed)}
							</CodeBlock>
						</div>
					</div>
				)}

				<DialogFooter className="mt-0 shrink-0">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						关闭
					</Button>
				</DialogFooter>
			</AdminDialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
