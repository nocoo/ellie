"use client";

import { renderContent } from "@ellie/shared/content";
import CharacterCount from "@tiptap/extension-character-count";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Selection, type Transaction } from "@tiptap/pm/state";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Check, Eye, FilePenLine, Loader2, PenLine, X } from "lucide-react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useId,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { useForumToast } from "@/components/forum/forum-toast";
import { PostEditorToolbar } from "@/components/forum/post-editor-toolbar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { handleSubmitShortcut } from "@/lib/composer-keyboard";
import { uploadPostImage } from "@/lib/forum-browser-api";
import { cn } from "@/lib/utils";
import { sanitizeUrl } from "@/viewmodels/forum/url-sanitize";
import type { DraftStatus } from "@/viewmodels/forum/use-composer-draft";

export interface PostEditorProps {
	initialContent?: string;
	onSubmit: (html: string) => void;
	onChange?: (html: string) => void;
	onBusyChange?: (busy: boolean) => void;
	draftStatus?: DraftStatus;
	previewTitle?: string;
	previewPrefix?: string;
	placeholder?: string;
	minLength?: number;
	maxLength?: number;
	disabled?: boolean;
	submitting?: boolean;
	canSubmit?: boolean;
	hideFooter?: boolean;
}

export interface PostEditorRef {
	getHTML: () => string;
	submit: () => void;
	focus: () => void;
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
function validateImages(files: File[]): string | null {
	for (const file of files) {
		if (!IMAGE_TYPES.includes(file.type)) return "仅支持 JPG、PNG、WebP 和 GIF 图片";
		if (file.size > 5 * 1024 * 1024) return `「${file.name}」超过 5 MB，请压缩后再上传`;
	}
	return null;
}

async function uploadImage(file: File): Promise<string> {
	const result = await uploadPostImage(file);
	if (result.kind === "success") return result.url;
	throw new Error(
		result.kind === "email-not-verified" ? "请先验证邮箱后再上传图片" : result.message,
	);
}

function imageErrorMessage(error: unknown): string {
	return error instanceof Error && !(error instanceof TypeError)
		? error.message
		: "上传失败，请重试";
}

const DRAFT_LABELS: Record<DraftStatus, string> = {
	empty: "草稿自动保存在当前标签页",
	saved: "草稿已保存 · 当前标签页",
	restored: "已恢复当前标签页的草稿",
	unavailable: "草稿未能保存，请勿关闭页面",
};

export const PostEditor = forwardRef<PostEditorRef, PostEditorProps>(function PostEditor(
	{
		initialContent,
		onSubmit,
		onChange,
		onBusyChange,
		draftStatus,
		previewTitle,
		previewPrefix = "",
		placeholder = "写下你想分享的内容…",
		minLength = 0,
		maxLength = 50000,
		disabled = false,
		submitting = false,
		canSubmit: canSubmitProp = true,
		hideFooter = false,
	},
	ref,
) {
	const toast = useForumToast();
	const statusId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const submitRef = useRef<() => void>(() => {});
	const uploadRef = useRef<(files: File[], position?: number) => Promise<void>>(async () => {});
	const changeRef = useRef(onChange);
	const busyChangeRef = useRef(onBusyChange);
	changeRef.current = onChange;
	busyChangeRef.current = onBusyChange;
	const uploadingRef = useRef(false);
	const [uploading, setUploading] = useState(false);
	const [uploadLabel, setUploadLabel] = useState("");
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [retryFiles, setRetryFiles] = useState<File[]>([]);
	const [mode, setMode] = useState("write");
	const editor = useEditor({
		immediatelyRender: false,
		extensions: [
			StarterKit.configure({
				heading: { levels: [2, 3, 4] },
				link: {
					openOnClick: false,
					isAllowedUri: (url) => sanitizeUrl(url).url !== null,
					shouldAutoLink: (url) => sanitizeUrl(url).url !== null,
				},
			}),
			Image.configure({ inline: false, allowBase64: false }),
			Placeholder.configure({ placeholder }),
			CharacterCount.configure({ limit: maxLength }),
		],
		content: initialContent ?? "",
		editable: !disabled && !submitting,
		onUpdate: ({ editor }) => changeRef.current?.(editor.getHTML()),
		editorProps: {
			attributes: {
				role: "textbox",
				"aria-label": "正文",
				"aria-multiline": "true",
				"aria-keyshortcuts": "Control+Enter Meta+Enter",
				"aria-describedby": statusId,
				class: "forum-content",
			},
			// Consume submission before ProseMirror's Mod-Enter hard-break command.
			handleKeyDown: (_view, event) => handleSubmitShortcut(event, () => submitRef.current()),
			handlePaste: (_view, event) => {
				const files = Array.from(event.clipboardData?.files ?? []);
				if (!files.length) return false;
				event.preventDefault();
				void uploadRef.current(files);
				return true;
			},
			handleDrop: (view, event, _slice, moved) => {
				const files = Array.from(event.dataTransfer?.files ?? []);
				if (moved || !files.length) return false;
				event.preventDefault();
				const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
				void uploadRef.current(files, position);
				return true;
			},
		},
	});

	useEffect(() => {
		editor?.setEditable(!disabled && !submitting, false);
	}, [editor, disabled, submitting]);

	const upload = useCallback(
		async (files: File[], position?: number) => {
			if (
				!editor ||
				editor.isDestroyed ||
				disabled ||
				submitting ||
				uploadingRef.current ||
				!files.length
			)
				return;
			setRetryFiles([]);
			const validationError = validateImages(files);
			if (validationError) {
				setUploadError(validationError);
				toast.error({ title: "图片上传失败", description: validationError });
				return;
			}
			uploadingRef.current = true;
			setUploading(true);
			setUploadError(null);
			busyChangeRef.current?.(true);
			let bookmark = (
				position === undefined
					? editor.state.selection
					: Selection.near(editor.state.doc.resolve(position))
			).getBookmark();
			const mapBookmark = ({ transaction }: { transaction: Transaction }) => {
				bookmark = bookmark.map(transaction.mapping);
			};
			editor.on("transaction", mapBookmark);
			let index = 0;
			try {
				for (const file of files) {
					setUploadLabel(`正在上传图片 ${index + 1} / ${files.length}…`);
					const url = await uploadImage(file);
					if (editor.isDestroyed) return;
					const selection = bookmark.resolve(editor.state.doc);
					editor.commands.insertContentAt(
						{ from: selection.from, to: selection.to },
						{ type: "image", attrs: { src: url } },
						{ updateSelection: false },
					);
					index++;
				}
				toast.success(files.length === 1 ? "图片已上传" : `${files.length} 张图片已上传`);
			} catch (error) {
				if (editor.isDestroyed) return;
				const message = imageErrorMessage(error);
				setUploadError(message);
				setRetryFiles(files.slice(index));
				toast.error({ title: "图片上传失败", description: message });
			} finally {
				editor.off("transaction", mapBookmark);
				uploadingRef.current = false;
				setUploading(false);
				busyChangeRef.current?.(false);
			}
		},
		[editor, disabled, submitting, toast],
	);
	uploadRef.current = upload;

	const handleSubmit = useCallback(() => {
		if (!editor || disabled || submitting || !canSubmitProp) return;
		if (uploadingRef.current) {
			toast.info("图片正在上传，请完成后再发布");
			return;
		}
		onSubmit(editor.getHTML());
	}, [editor, disabled, submitting, canSubmitProp, onSubmit, toast]);
	submitRef.current = handleSubmit;

	useImperativeHandle(
		ref,
		() => ({
			getHTML: () => editor?.getHTML() ?? "",
			submit: handleSubmit,
			focus: () => {
				editor?.commands.focus();
			},
		}),
		[editor, handleSubmit],
	);

	const document = useEditorState({
		editor,
		selector: () => ({
			count: editor?.storage.characterCount.characters() ?? 0,
			html: editor?.getHTML() ?? "",
			empty: editor?.isEmpty ?? true,
		}),
	});
	const count = document?.count ?? 0;
	const preview = useMemo(
		() => (mode === "preview" ? renderContent(previewPrefix + (document?.html ?? "")) : ""),
		[mode, previewPrefix, document?.html],
	);

	return (
		<Tabs
			value={mode}
			onValueChange={(value) => setMode(String(value))}
			className="composer flex h-full min-h-0 flex-col gap-0 overflow-hidden rounded-xl border border-border bg-card transition-shadow focus-within:border-primary/40 focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.06)]"
		>
			<div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
				<TabsList aria-label="编辑器模式" className="h-8">
					<TabsTrigger value="write" className="gap-1.5 px-3">
						<PenLine className="size-3.5" />
						撰写
					</TabsTrigger>
					<TabsTrigger value="preview" className="gap-1.5 px-3">
						<Eye className="size-3.5" />
						预览
					</TabsTrigger>
				</TabsList>
				<span className="hidden text-xs text-muted-foreground sm:block">
					{mode === "preview" ? "发布后的阅读效果" : "支持粘贴或拖入图片 · 最大 5 MB"}
				</span>
			</div>
			<TabsContent
				value="write"
				keepMounted
				className="flex min-h-0 flex-1 flex-col data-hidden:hidden"
			>
				{editor && (
					<PostEditorToolbar
						editor={editor}
						disabled={disabled || submitting}
						uploading={uploading}
						onImage={() => inputRef.current?.click()}
					/>
				)}
				<input
					ref={inputRef}
					type="file"
					multiple
					accept={IMAGE_TYPES.join(",")}
					disabled={uploading || disabled || submitting}
					aria-label="上传图片文件"
					tabIndex={-1}
					className="hidden"
					onChange={(event) => {
						const files = Array.from(event.target.files ?? []);
						event.target.value = "";
						void upload(files);
					}}
				/>
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard focus is provided by the nested contenteditable */}
				{/* biome-ignore lint/a11y/noStaticElementInteractions: padding clicks extend the editor's focus surface */}
				<div
					className="tiptap-content-wrap flex min-h-0 flex-1 cursor-text flex-col overflow-y-auto overscroll-contain"
					onClick={(event) => {
						if (
							!editor ||
							disabled ||
							submitting ||
							(event.target as HTMLElement).closest(".ProseMirror")
						)
							return;
						editor.chain().focus("end").run();
					}}
				>
					<EditorContent
						editor={editor}
						className="tiptap-content min-h-48 flex-1 px-4 py-4 text-base leading-7 sm:px-5"
					/>
				</div>
			</TabsContent>
			<TabsContent
				value="preview"
				className="composer-preview min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5"
				onKeyDown={(event) => {
					handleSubmitShortcut(event.nativeEvent, handleSubmit);
				}}
			>
				{previewTitle && (
					<h2 className="mb-5 break-words text-xl font-semibold tracking-tight">{previewTitle}</h2>
				)}
				{document?.empty && !previewPrefix ? (
					<div className="flex h-full min-h-36 flex-col items-center justify-center gap-3 text-muted-foreground">
						<FilePenLine className="size-7 opacity-50" />
						<p className="text-sm">写点内容，来看看发布后的效果</p>
					</div>
				) : (
					<div
						className="forum-content break-words text-base leading-7"
						// biome-ignore lint/security/noDangerouslySetInnerHtml: renderContent sanitizes the preview with the published-post allowlist
						dangerouslySetInnerHTML={{ __html: preview }}
					/>
				)}
			</TabsContent>
			{uploadError && (
				<div
					role="alert"
					className="flex shrink-0 items-center gap-2 border-t border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"
				>
					<span className="flex-1">{uploadError}</span>
					{retryFiles.length > 0 && (
						<Button
							variant="ghost"
							size="sm"
							disabled={uploading}
							onClick={() => void upload(retryFiles)}
						>
							重试
						</Button>
					)}
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="关闭上传提示"
						onClick={() => setUploadError(null)}
					>
						<X className="size-3.5" />
					</Button>
				</div>
			)}
			<div
				id={statusId}
				className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border bg-muted/15 px-3 py-2 text-xs text-muted-foreground"
			>
				<span
					className={cn(
						"flex min-w-0 items-center gap-1.5",
						draftStatus === "unavailable" && "text-destructive",
					)}
					role="status"
				>
					{uploading ? (
						<>
							<Loader2 className="size-3.5 animate-spin" />
							{uploadLabel}
						</>
					) : draftStatus ? (
						<>
							{draftStatus === "saved" && <Check className="size-3.5 text-primary" />}
							{DRAFT_LABELS[draftStatus]}
						</>
					) : (
						"Enter 换行 · Ctrl+Enter 提交"
					)}
				</span>
				<span
					className={cn(
						"ml-auto whitespace-nowrap tabular-nums",
						count >= maxLength && "text-destructive",
					)}
				>
					{minLength > 0 && count < minLength && <span className="mr-2">至少 {minLength} 字</span>}
					{count} / {maxLength}
				</span>
				{!hideFooter && (
					<Button
						size="sm"
						onClick={handleSubmit}
						disabled={disabled || submitting || uploading || !canSubmitProp}
						aria-busy={submitting}
					>
						{submitting ? "提交中..." : "提交"}
					</Button>
				)}
			</div>
		</Tabs>
	);
});
