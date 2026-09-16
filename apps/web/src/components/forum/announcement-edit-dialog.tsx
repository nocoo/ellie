"use client";

// AnnouncementEditDialog — moderator UI for editing a forum's
// announcement HTML.
//
// Layout (per reviewer guidance, msg e5bba9a6):
//   - Textarea (raw HTML, freely editable)
//   - Live preview rendered through `SafeRichHtml` (UX only — Worker
//     is the authoritative sanitizer)
//   - Byte counter with the soft 4 KiB advisory; the counter turns red
//     past the budget but the Save button is NOT disabled because the
//     Worker computes the limit POST-sanitize. Over-budget input that
//     sanitizes back into 4 KiB is legal; we let the Worker decide.
//   - DialogErrorBanner for save errors (PAYLOAD_TOO_LARGE, FORBIDDEN, …)

import { Eye, Megaphone, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-error";
import { setForumAnnouncement } from "@/lib/forum-announcement-api";
import { cn } from "@/lib/utils";
import { DialogErrorBanner } from "./dialog-error-banner";
import { DialogHeroHeader } from "./dialog-hero-header";
import { SafeRichHtml } from "./safe-rich-html";

const ANNOUNCEMENT_SOFT_LIMIT = 4096;

const ERROR_CODE_MESSAGES: Record<string, string> = {
	PAYLOAD_TOO_LARGE: "内容过长（清洗后超过 4 KiB），请精简后重试",
	FORBIDDEN: "你没有编辑此版块公告的权限",
	FORBIDDEN_MOD_ONLY: "你没有编辑此版块公告的权限",
	FORUM_NOT_FOUND: "版块不存在或已删除",
	USER_BANNED: "你的账号已被封禁",
	INVALID_BODY: "请求格式错误",
};

interface AnnouncementEditDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	forumId: number;
	forumName: string;
	initialAnnouncement: string;
}

export function AnnouncementEditDialog({
	open,
	onOpenChange,
	forumId,
	forumName,
	initialAnnouncement,
}: AnnouncementEditDialogProps) {
	const router = useRouter();
	const [draft, setDraft] = useState(initialAnnouncement);
	const [submitting, setSubmitting] = useState(false);
	const submittingRef = useRef(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setDraft(initialAnnouncement);
			setError(null);
		}
	}, [open, initialAnnouncement]);

	const byteLength = useMemo(() => new TextEncoder().encode(draft).byteLength, [draft]);
	const overBudget = byteLength > ANNOUNCEMENT_SOFT_LIMIT;

	const handleSave = async () => {
		if (submittingRef.current) return;
		submittingRef.current = true;
		setSubmitting(true);
		setError(null);
		try {
			await setForumAnnouncement(forumId, draft);
			onOpenChange(false);
			router.refresh();
		} catch (err) {
			const fallback = "保存失败，请稍后重试";
			if (err instanceof ApiError) {
				setError(ERROR_CODE_MESSAGES[err.code] ?? err.message ?? fallback);
			} else if (err instanceof Error) {
				setError(err.message || fallback);
			} else {
				setError(fallback);
			}
		} finally {
			submittingRef.current = false;
			setSubmitting(false);
		}
	};

	const handleOpenChange = (next: boolean) => {
		if (submittingRef.current) return;
		onOpenChange(next);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent
				className="max-h-[90dvh] flex flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
				showCloseButton={false}
			>
				<DialogHeroHeader
					icon={<Megaphone className="h-5 w-5 text-primary" />}
					title="编辑版块公告"
					description={`${forumName} · 支持简单 HTML（链接、图片、加粗、颜色）`}
					onClose={() => handleOpenChange(false)}
					closeDisabled={submitting}
				/>

				{error && <DialogErrorBanner message={error} />}

				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain grid gap-5 px-5 py-5 sm:grid-cols-2">
					<div className="min-w-0 flex flex-col gap-2">
						<label htmlFor="announcement-textarea" className="text-sm font-medium text-foreground">
							内容
						</label>
						<Textarea
							id="announcement-textarea"
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							rows={12}
							placeholder="留空可清除公告"
							disabled={submitting}
							className="min-h-56 flex-1 resize-none font-mono text-sm leading-6"
						/>
						<p className={cn("text-xs", overBudget ? "text-destructive" : "text-muted-foreground")}>
							约 {byteLength} / {ANNOUNCEMENT_SOFT_LIMIT} 字节，过长时请精简内容
						</p>
					</div>

					<div className="min-w-0 flex flex-col gap-2">
						<div className="flex items-center gap-2 text-sm font-medium text-foreground">
							<Eye className="h-4 w-4 text-primary" />
							预览
						</div>
						<div className="min-h-56 flex-1 overflow-hidden break-words rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground">
							{draft.trim() === "" ? (
								<span className="text-muted-foreground italic">（无内容）</span>
							) : (
								<SafeRichHtml html={draft} className="leading-relaxed" />
							)}
						</div>
						<p className="text-xs text-muted-foreground">
							保存后会更新版块公告；留空保存可清除公告。
						</p>
					</div>
				</div>

				<div className="shrink-0 px-5 py-4 border-t border-border bg-muted/20">
					<div className="flex items-center justify-end gap-2">
						<Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={submitting}>
							取消
						</Button>
						<Button onClick={handleSave} disabled={submitting} className="gap-2">
							<Save className="h-4 w-4" />
							{submitting ? "保存中..." : "保存"}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
