"use client";

import { Button } from "@nocoo/basalt/components/button";
import { Input } from "@nocoo/basalt/components/input";
import { Label } from "@nocoo/basalt/components/label";
import { ArrowLeft, PenLine, Send } from "@nocoo/basalt/icons";
import Link from "next/link";
import { useRef, useState } from "react";
import { BreadcrumbBar } from "@/components/forum/breadcrumb-bar";
import { PostEditor, type PostEditorRef } from "@/components/forum/post-editor";
import { ThreadTypePicker } from "@/components/forum/thread-type-picker";
import type { BreadcrumbItem } from "@/components/layout/breadcrumbs";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { type ForumThreadTypesPublic, shouldShowPicker } from "@/viewmodels/forum/thread-types";
import { useThreadSubmit } from "@/viewmodels/forum/use-thread-submit";
import { writeGatePreflight } from "@/viewmodels/forum/write-gate";

interface NewThreadFormProps {
	breadcrumbs: BreadcrumbItem[];
	forumId: number;
	forumName: string;
	threadTypes: ForumThreadTypesPublic;
	selfEmailVerifiedAt: number;
}

export function NewThreadForm({
	breadcrumbs,
	forumId,
	forumName,
	threadTypes,
	selfEmailVerifiedAt,
}: NewThreadFormProps) {
	const editorRef = useRef<PostEditorRef>(null);
	const checkingRef = useRef(false);
	const [checking, setChecking] = useState(false);
	const [uploading, setUploading] = useState(false);
	const { canCreateThread, isLoading } = useFeatureFlags();
	const showPicker = shouldShowPicker(threadTypes);
	const typeIdRequired = showPicker && threadTypes.required;
	const { state, actions, validation } = useThreadSubmit({ forumId, typeIdRequired });
	const busy = checking || state.submitting;
	const canSubmit =
		validation.canSubmit && state.draftReady && canCreateThread && !isLoading && !busy;

	const handleSubmit = async (html: string) => {
		if (!canSubmit || checkingRef.current) return;
		checkingRef.current = true;
		setChecking(true);
		try {
			if (await writeGatePreflight(selfEmailVerifiedAt, "thread")) return;
			await actions.handleSubmit(html);
		} finally {
			checkingRef.current = false;
			setChecking(false);
		}
	};

	return (
		<div className="mx-auto max-w-5xl space-y-4">
			<BreadcrumbBar items={breadcrumbs} />
			<div className="flex items-center justify-between gap-3 py-1">
				<div className="flex min-w-0 items-center gap-3">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-basalt-primary/10 text-basalt-primary">
						<PenLine className="size-5" aria-hidden="true" />
					</div>
					<div className="min-w-0">
						<h1 className="text-xl font-semibold tracking-tight">发表主题</h1>
						<p className="truncate text-sm text-basalt-muted-foreground">发布到 {forumName}</p>
					</div>
				</div>
				<Button asChild variant="outline" size="sm" disabled={busy || uploading}>
					<Link prefetch={false} href={`/forums/${forumId}`}>
						<ArrowLeft className="size-4" aria-hidden="true" />
						返回版块
					</Link>
				</Button>
			</div>
			{!canCreateThread ? (
				<div
					className="rounded-2xl border border-basalt-border bg-basalt-card p-6 text-sm text-basalt-muted-foreground"
					role="status"
				>
					发帖功能已暂时关闭，请稍后再试。
				</div>
			) : (
				<section
					className="overflow-hidden rounded-2xl border border-basalt-border bg-basalt-card"
					aria-label="编辑主题"
					aria-busy={busy}
				>
					<div className="space-y-2 px-5 pt-5">
						<div className="flex items-center justify-between gap-3">
							<Label htmlFor="new-thread-subject">主题标题</Label>
							<span className="text-xs tabular-nums text-basalt-muted-foreground">
								{state.subject.length}/100
							</span>
						</div>
						<Input
							id="new-thread-subject"
							value={state.subject}
							onChange={(e) => actions.setSubject(e.target.value)}
							maxLength={100}
							disabled={busy || !state.draftReady}
							placeholder="用一句话概括你想分享的内容"
							className="h-11 text-base"
							aria-invalid={!!validation.subjectError}
						/>
						<p
							className={
								validation.subjectError
									? "text-xs text-basalt-destructive"
									: "text-xs text-basalt-muted-foreground"
							}
						>
							{validation.subjectError ?? "标题 4–100 字，正文至少 10 字。"}
						</p>
					</div>
					{showPicker && (
						<ThreadTypePicker
							types={threadTypes.types}
							value={state.typeId}
							onChange={actions.setTypeId}
							required={typeIdRequired}
							error={validation.typeIdError}
							disabled={busy || !state.draftReady}
						/>
					)}
					{state.error && (
						<p
							role="alert"
							className="mx-5 mt-4 rounded-xl bg-basalt-destructive/10 p-3 text-sm text-basalt-destructive"
						>
							{state.error}
						</p>
					)}
					<div className="h-[55dvh] min-h-96 px-5 py-4">
						{state.draftReady && (
							<PostEditor
								ref={editorRef}
								initialContent={state.content}
								onChange={actions.setContent}
								onBusyChange={setUploading}
								draftStatus={state.draftStatus}
								previewTitle={state.subject}
								minLength={10}
								onSubmit={handleSubmit}
								placeholder="写下你的主题内容…"
								submitting={busy}
								canSubmit={canSubmit}
								hideFooter
							/>
						)}
					</div>
					<div className="flex flex-wrap items-center justify-between gap-3 border-t border-basalt-border bg-basalt-muted/20 px-5 py-4">
						<span className="text-xs text-basalt-muted-foreground">
							<span className="sm:hidden">Enter 换行</span>
							<span className="hidden sm:inline">
								Enter 换行 · Ctrl+Enter 发布（Mac 也可 ⌘+Enter）
							</span>
						</span>
						<Button
							onClick={() => {
								editorRef.current?.submit();
							}}
							disabled={!canSubmit || uploading}
							aria-busy={busy}
						>
							<Send className="size-4" aria-hidden="true" />
							{busy ? "发布中…" : "发布主题"}
						</Button>
					</div>
				</section>
			)}
		</div>
	);
}
