"use client";

// New thread dialog with glass-morphism styling
// Opens as a modal overlay for creating new forum threads

import { PostEditor } from "@/components/forum/post-editor";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { ApiError, apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { AlertCircle, PenLine, Send, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

interface NewThreadDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	forumId: number;
	forumName: string;
}

const ERROR_MESSAGES: Record<string, string> = {
	UNAUTHORIZED: "请先登录后再发帖",
	FORUM_CLOSED: "该版块已关闭，无法发帖",
	CONTENT_BANNED: "内容包含违禁词，请修改后重试",
	RATE_LIMITED: "操作过于频繁，请稍后再试",
};

interface CreateThreadResponse {
	id: number;
}

export function NewThreadDialog({ open, onOpenChange, forumId, forumName }: NewThreadDialogProps) {
	const router = useRouter();
	const { canCreateThread } = useFeatureFlags();
	const [subject, setSubject] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const editorRef = useRef<{ getHTML: () => string } | null>(null);

	// Validation
	const subjectTooShort = subject.trim().length > 0 && subject.trim().length < 4;
	const subjectTooLong = subject.trim().length > 100;
	const subjectError = subjectTooShort
		? "标题至少需要4个字符"
		: subjectTooLong
			? "标题不能超过100个字符"
			: null;

	const canSubmit = subject.trim().length >= 4 && subject.trim().length <= 100 && !submitting;

	const handleSubmit = useCallback(
		async (html: string) => {
			// Validate subject
			if (subject.trim().length < 4) {
				setError("请输入标题（至少4个字符）");
				return;
			}

			// Validate content
			const strippedContent = html.replace(/<[^>]*>/g, "").trim();
			if (strippedContent.length < 10) {
				setError("内容太短，请输入更多内容（至少10个字符）");
				return;
			}

			setSubmitting(true);
			setError(null);

			try {
				const response = await apiClient.post<CreateThreadResponse>("/api/v1/threads", {
					forumId,
					subject: subject.trim(),
					content: html,
				});

				onOpenChange(false);
				setSubject("");

				// Navigate to the new thread
				if (response.data?.id) {
					router.push(`/threads/${response.data.id}`);
				} else {
					router.refresh();
				}
			} catch (err) {
				const code = err instanceof ApiError ? err.code : "UNKNOWN";
				const message = ERROR_MESSAGES[code] ?? "发帖失败，请稍后重试";
				setError(message);
			} finally {
				setSubmitting(false);
			}
		},
		[forumId, subject, onOpenChange, router],
	);

	// Reset state when dialog closes
	const handleOpenChange = (open: boolean) => {
		if (!open) {
			setSubject("");
			setError(null);
		}
		onOpenChange(open);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent
				className={cn(
					"glass-panel",
					"w-[calc(100vw-2rem)] sm:w-[800px] md:w-[960px] lg:w-[1024px]",
					"h-[calc(75vw-1.5rem)] sm:h-[600px] md:h-[720px] lg:h-[768px]",
					"max-h-[90vh] overflow-hidden flex flex-col",
					"rounded-xl p-0",
				)}
				showCloseButton={false}
			>
				{/* Feature disabled state */}
				{!canCreateThread ? (
					<div className="flex flex-col items-center justify-center h-full gap-4 p-8">
						<div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
							<XCircle className="h-8 w-8 text-muted-foreground" />
						</div>
						<div className="text-center">
							<h3 className="text-lg font-semibold text-foreground mb-2">发帖功能已暂时关闭</h3>
							<p className="text-sm text-muted-foreground">管理员已暂停发帖功能，请稍后再试</p>
						</div>
						<Button variant="outline" onClick={() => onOpenChange(false)}>
							关闭
						</Button>
					</div>
				) : (
					<>
						{/* Header */}
						<DialogHeader className="px-5 pt-5 pb-4 border-b border-border/50">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-3">
									<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
										<PenLine className="h-5 w-5 text-primary" />
									</div>
									<div>
										<DialogTitle className="text-lg">发表新帖</DialogTitle>
										<DialogDescription className="text-xs mt-0.5">
											发布到：{forumName}
										</DialogDescription>
									</div>
								</div>
								<Button
									variant="ghost"
									size="icon-sm"
									onClick={() => handleOpenChange(false)}
									className="text-muted-foreground hover:text-foreground"
								>
									<span className="sr-only">关闭</span>
									<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
										<path
											d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z"
											fill="currentColor"
											fillRule="evenodd"
											clipRule="evenodd"
										/>
									</svg>
								</Button>
							</div>
						</DialogHeader>

						{/* Error display */}
						{error && (
							<div className="mx-5 mt-4 flex items-start gap-3 rounded-lg bg-destructive/10 border border-destructive/30 p-3">
								<AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
								<p className="text-sm text-destructive">{error}</p>
							</div>
						)}

						{/* Subject input */}
						<div className="px-5 pt-4">
							<div className="relative">
								<input
									type="text"
									value={subject}
									onChange={(e) => setSubject(e.target.value)}
									placeholder="输入帖子标题..."
									disabled={submitting}
									maxLength={100}
									className={cn(
										"w-full h-11 rounded-lg border bg-card/50 px-4 text-base font-medium",
										"placeholder:text-muted-foreground/60 outline-none transition-colors",
										"focus:border-primary focus:ring-2 focus:ring-primary/20",
										"disabled:opacity-50 disabled:cursor-not-allowed",
										subjectError
											? "border-destructive focus:border-destructive focus:ring-destructive/20"
											: "border-border/60",
									)}
								/>
								<span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
									{subject.length}/100
								</span>
							</div>
							{subjectError && <p className="mt-1.5 text-xs text-destructive">{subjectError}</p>}
						</div>

						{/* Editor area */}
						<div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
							<div className="rounded-lg border border-border/60 bg-card/50 overflow-hidden">
								<PostEditor
									ref={editorRef}
									onSubmit={handleSubmit}
									placeholder="写下你的帖子内容..."
									maxLength={50000}
									submitting={submitting}
									canSubmit={canSubmit}
									hideFooter
								/>
							</div>
						</div>

						{/* Footer */}
						<div className="px-5 py-4 border-t border-border/50 bg-muted/30">
							<div className="flex items-center justify-between">
								<p className="text-xs text-muted-foreground">
									支持富文本编辑，可插入链接和表情
								</p>
								<div className="flex items-center gap-2">
									<Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={submitting}>
										取消
									</Button>
									<Button
										onClick={() => {
											const html = editorRef.current?.getHTML() ?? "";
											handleSubmit(html);
										}}
										disabled={!canSubmit}
										className="gap-2"
									>
										<Send className="h-4 w-4" />
										{submitting ? "发布中..." : "发布帖子"}
									</Button>
								</div>
							</div>
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
