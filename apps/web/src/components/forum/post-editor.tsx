"use client";

// components/forum/post-editor.tsx — Rich text editor (Tiptap)
// Ref: 04e §RichTextEditor — toolbar + editor + character count
//
// B3 changes (review msg=d57926b5):
//   - Underline now actually works (extension-underline registered).
//   - Image insert button uploads via `uploadPostImage` (Phase A
//     `forum-browser-api` facade over `apiClient.upload`). The §5.4
//     EMAIL_NOT_VERIFIED dialog is dispatched globally from
//     `apiClient.upload` via the shared `throwForErrorBody` path; this
//     component only renders inline error + toast, no re-dispatch.
//   - Link popover replaces the old `window.prompt` flow. URL is
//     sanitized (rejects javascript:/data:/vbscript:/file:) before
//     handing it to Tiptap's setLink.
//   - Toolbar uses lucide icons + tooltips and is grouped:
//       Block(H2/H3/Quote/Code) | Inline(B/I/U) | List(UL/OL) | Insert(Link/Image/Emoji)
//   - Wrapper drops the always-on `ring-1 ring-border` halo; uses a
//     border that highlights on focus-within instead. The inner blue
//     ProseMirror outline is killed via tailwind.css.

import { EmojiPicker } from "@/components/forum/emoji-picker";
import { useForumToast } from "@/components/forum/forum-toast";
import { SmileyPicker } from "@/components/forum/smiley-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { uploadPostImage } from "@/lib/forum-browser-api";
import { sanitizeUrl } from "@/viewmodels/forum/url-sanitize";
import CharacterCount from "@tiptap/extension-character-count";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
	Bold as BoldIcon,
	Code as CodeIcon,
	Heading2 as Heading2Icon,
	Heading3 as Heading3Icon,
	Image as ImageIcon,
	Italic as ItalicIcon,
	Link as LinkIcon,
	List as ListIcon,
	ListOrdered as ListOrderedIcon,
	Loader2 as LoaderIcon,
	Quote as QuoteIcon,
	Underline as UnderlineIcon,
} from "lucide-react";
import {
	type FormEvent,
	forwardRef,
	useCallback,
	useImperativeHandle,
	useRef,
	useState,
} from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PostEditorProps {
	initialContent?: string;
	onSubmit: (html: string) => void;
	placeholder?: string;
	maxLength?: number;
	disabled?: boolean;
	subject?: string;
	onSubjectChange?: (v: string) => void;
	submitting?: boolean;
	canSubmit?: boolean;
	/** Hide the built-in footer (character count + submit button) */
	hideFooter?: boolean;
}

export interface PostEditorRef {
	getHTML: () => string;
}

// ---------------------------------------------------------------------------
// Toolbar toggle button (with tooltip)
// ---------------------------------------------------------------------------

function ToolbarButton({
	active,
	onClick,
	children,
	title,
	disabled,
}: {
	active?: boolean;
	onClick: () => void;
	children: React.ReactNode;
	title: string;
	disabled?: boolean;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						onClick={onClick}
						aria-label={title}
						disabled={disabled}
						className={`inline-flex h-7 w-7 items-center justify-center rounded text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
							active ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
						}`}
					>
						{children}
					</button>
				}
			/>
			<TooltipContent>{title}</TooltipContent>
		</Tooltip>
	);
}

// ---------------------------------------------------------------------------
// Link popover — URL + display text, sanitized before applying
// ---------------------------------------------------------------------------

function LinkPopover({ editor }: { editor: Editor }) {
	const [open, setOpen] = useState(false);
	const [url, setUrl] = useState("");
	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);

	// Pre-fill from current selection / existing link when opening
	const handleOpenChange = useCallback(
		(next: boolean) => {
			setOpen(next);
			if (next) {
				const existingHref = (editor.getAttributes("link").href as string | undefined) ?? "";
				setUrl(existingHref);
				const { from, to } = editor.state.selection;
				const selected = editor.state.doc.textBetween(from, to, " ");
				setText(selected);
				setError(null);
			}
		},
		[editor],
	);

	const handleSubmit = useCallback(
		(e: FormEvent) => {
			e.preventDefault();
			const sanitized = sanitizeUrl(url);
			if (!sanitized.url) {
				setError("不支持的链接地址");
				return;
			}

			const chain = editor.chain().focus().extendMarkRange("link");

			const { from, to } = editor.state.selection;
			const trimmedText = text.trim();
			if (from === to && trimmedText.length > 0) {
				// No selection: insert the display text and link it.
				chain
					.insertContent({
						type: "text",
						text: trimmedText,
						marks: [{ type: "link", attrs: { href: sanitized.url } }],
					})
					.run();
			} else {
				chain.setLink({ href: sanitized.url }).run();
			}
			setOpen(false);
		},
		[editor, url, text],
	);

	const handleUnlink = useCallback(() => {
		editor.chain().focus().unsetLink().run();
		setOpen(false);
	}, [editor]);

	const isLinkActive = editor.isActive("link");

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<Tooltip>
				<TooltipTrigger
					render={
						<PopoverTrigger
							render={
								<button
									type="button"
									aria-label="插入链接"
									className={`inline-flex h-7 w-7 items-center justify-center rounded text-xs font-medium transition-colors ${
										isLinkActive
											? "bg-primary text-primary-foreground"
											: "hover:bg-muted text-muted-foreground"
									}`}
								>
									<LinkIcon className="h-3.5 w-3.5" />
								</button>
							}
						/>
					}
				/>
				<TooltipContent>插入链接</TooltipContent>
			</Tooltip>
			<PopoverContent align="start" className="w-80">
				<form onSubmit={handleSubmit} className="flex flex-col gap-2">
					<label className="text-xs text-muted-foreground" htmlFor="link-url">
						链接地址
					</label>
					<Input
						id="link-url"
						type="text"
						placeholder="https://example.com"
						value={url}
						onChange={(e) => {
							setUrl(e.target.value);
							setError(null);
						}}
						autoFocus
					/>
					<label className="text-xs text-muted-foreground" htmlFor="link-text">
						显示文字（可选，未选中文本时使用）
					</label>
					<Input
						id="link-text"
						type="text"
						placeholder="链接显示的文字"
						value={text}
						onChange={(e) => setText(e.target.value)}
					/>
					{error && <p className="text-xs text-destructive">{error}</p>}
					<div className="flex items-center justify-between gap-2 pt-1">
						{isLinkActive ? (
							<Button type="button" size="sm" variant="ghost" onClick={handleUnlink}>
								移除链接
							</Button>
						) : (
							<span />
						)}
						<div className="flex gap-2">
							<Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
								取消
							</Button>
							<Button type="submit" size="sm">
								确定
							</Button>
						</div>
					</div>
				</form>
			</PopoverContent>
		</Popover>
	);
}

// ---------------------------------------------------------------------------
// Image upload button — uploadPostImage (apiClient.upload) + §5.4 dispatch in apiClient
// ---------------------------------------------------------------------------

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

function ImageUploadButton({ editor }: { editor: Editor }) {
	const toast = useForumToast();
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleClick = useCallback(() => {
		if (uploading) return;
		setError(null);
		inputRef.current?.click();
	}, [uploading]);

	const handleChange = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			// Always reset so re-selecting the same file works again.
			e.target.value = "";
			if (!file) return;

			setUploading(true);
			setError(null);

			try {
				const parsed = await uploadPostImage(file);
				if (parsed.kind === "success") {
					editor.chain().focus().setImage({ src: parsed.url }).run();
					toast.success("图片已上传");
				} else if (parsed.kind === "email-not-verified") {
					// `apiClient.upload` already dispatched the global §5.4 event.
					setError("请先验证邮箱后再上传图片");
					toast.error({ title: "图片上传失败", description: "请先验证邮箱后再上传图片" });
				} else {
					setError(parsed.message);
					toast.error({ title: "图片上传失败", description: parsed.message });
				}
			} catch {
				setError("上传失败，请重试");
				toast.error({ title: "图片上传失败", description: "上传失败，请重试" });
			} finally {
				setUploading(false);
			}
		},
		[editor, toast],
	);

	return (
		<>
			<Tooltip>
				<TooltipTrigger
					render={
						<button
							type="button"
							onClick={handleClick}
							disabled={uploading}
							aria-label="插入图片"
							className="inline-flex h-7 w-7 items-center justify-center rounded text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
						>
							{uploading ? (
								<LoaderIcon className="h-3.5 w-3.5 animate-spin" />
							) : (
								<ImageIcon className="h-3.5 w-3.5" />
							)}
						</button>
					}
				/>
				<TooltipContent>{error ? error : "插入图片"}</TooltipContent>
			</Tooltip>
			<input
				ref={inputRef}
				type="file"
				accept={IMAGE_ACCEPT}
				onChange={handleChange}
				className="hidden"
			/>
		</>
	);
}

// ---------------------------------------------------------------------------
// Toolbar — grouped: Block | Inline | List | Insert
// ---------------------------------------------------------------------------

function Toolbar({ editor }: { editor: Editor }) {
	return (
		<TooltipProvider delay={400}>
			<div className="flex items-center gap-0.5 border-b px-2 py-1 flex-wrap">
				{/* Block */}
				<ToolbarButton
					active={editor.isActive("heading", { level: 2 })}
					onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
					title="标题 2"
				>
					<Heading2Icon className="h-3.5 w-3.5" />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("heading", { level: 3 })}
					onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
					title="标题 3"
				>
					<Heading3Icon className="h-3.5 w-3.5" />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("blockquote")}
					onClick={() => editor.chain().focus().toggleBlockquote().run()}
					title="引用"
				>
					<QuoteIcon className="h-3.5 w-3.5" />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("codeBlock")}
					onClick={() => editor.chain().focus().toggleCodeBlock().run()}
					title="代码块"
				>
					<CodeIcon className="h-3.5 w-3.5" />
				</ToolbarButton>

				<span className="mx-1 h-4 w-px bg-border" />

				{/* Inline */}
				<ToolbarButton
					active={editor.isActive("bold")}
					onClick={() => editor.chain().focus().toggleBold().run()}
					title="粗体"
				>
					<BoldIcon className="h-3.5 w-3.5" />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("italic")}
					onClick={() => editor.chain().focus().toggleItalic().run()}
					title="斜体"
				>
					<ItalicIcon className="h-3.5 w-3.5" />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("underline")}
					onClick={() => editor.chain().focus().toggleUnderline().run()}
					title="下划线"
				>
					<UnderlineIcon className="h-3.5 w-3.5" />
				</ToolbarButton>

				<span className="mx-1 h-4 w-px bg-border" />

				{/* List */}
				<ToolbarButton
					active={editor.isActive("bulletList")}
					onClick={() => editor.chain().focus().toggleBulletList().run()}
					title="无序列表"
				>
					<ListIcon className="h-3.5 w-3.5" />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("orderedList")}
					onClick={() => editor.chain().focus().toggleOrderedList().run()}
					title="有序列表"
				>
					<ListOrderedIcon className="h-3.5 w-3.5" />
				</ToolbarButton>

				<span className="mx-1 h-4 w-px bg-border" />

				{/* Insert */}
				<LinkPopover editor={editor} />
				<ImageUploadButton editor={editor} />
				<SmileyPicker onSelect={(code) => editor.chain().focus().insertContent(`${code} `).run()} />
				<EmojiPicker onSelect={(emoji) => editor.chain().focus().insertContent(emoji).run()} />
			</div>
		</TooltipProvider>
	);
}

// ---------------------------------------------------------------------------
// PostEditor
// ---------------------------------------------------------------------------

const MAX_LENGTH = 50000;

export const PostEditor = forwardRef<PostEditorRef, PostEditorProps>(function PostEditor(
	{
		initialContent,
		onSubmit,
		placeholder = "输入内容...",
		maxLength = MAX_LENGTH,
		disabled = false,
		subject,
		onSubjectChange,
		submitting = false,
		canSubmit: canSubmitProp = true,
		hideFooter = false,
	},
	ref,
) {
	const editor = useEditor({
		immediatelyRender: false,
		extensions: [
			StarterKit.configure({
				heading: { levels: [2, 3, 4] },
			}),
			Underline,
			Link.configure({
				openOnClick: false,
				// Apply the same allow-list to paste / autolink / HTML parse
				// paths so a `javascript:` URL pasted into the editor cannot
				// reach the DOM. The popover already guards the manual flow.
				isAllowedUri: (url) => sanitizeUrl(url).url !== null,
				shouldAutoLink: (url) => sanitizeUrl(url).url !== null,
			}),
			Image.configure({
				inline: false,
				allowBase64: false,
				HTMLAttributes: {
					class: "max-w-full h-auto rounded-md",
				},
			}),
			Placeholder.configure({ placeholder }),
			CharacterCount.configure({ limit: maxLength }),
		],
		content: initialContent ?? "",
		editable: !disabled,
	});

	// Expose getHTML method via ref
	useImperativeHandle(
		ref,
		() => ({
			getHTML: () => editor?.getHTML() ?? "",
		}),
		[editor],
	);

	const handleSubmit = useCallback(() => {
		if (!editor || disabled || submitting) return;
		onSubmit(editor.getHTML());
	}, [editor, disabled, submitting, onSubmit]);

	const charCount = editor?.storage.characterCount;

	return (
		<div className="flex h-full min-h-0 flex-col rounded-lg bg-card border border-border overflow-hidden">
			{/* Subject (thread mode only) */}
			{subject !== undefined && onSubjectChange && (
				<div className="border-b px-3 py-2">
					<input
						type="text"
						value={subject}
						onChange={(e) => onSubjectChange(e.target.value)}
						placeholder="输入标题..."
						disabled={disabled}
						className="w-full bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground outline-none"
					/>
				</div>
			)}

			{/* Toolbar */}
			{editor && !disabled && <Toolbar editor={editor} />}

			{/* Editor area — grows to fill the dialog body, scrolls internally.
			    A click anywhere in this region (including padding / empty
			    whitespace below the last paragraph) should focus the tiptap
			    editor at the end of the document, so the entire visible
			    surface acts like one big input. Without this handler, only
			    the actual ProseMirror text rows accept focus and clicks on
			    the surrounding padding do nothing. Keyboard users already
			    reach the editor via Tab — the click handler here is a
			    pointer-only affordance that mirrors what tiptap's own
			    surface does, so no key handler is needed. */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only focus shim; keyboard users reach the editor via Tab */}
			<div
				className="tiptap-content-wrap flex flex-1 min-h-0 cursor-text flex-col overflow-y-auto"
				onClick={(e) => {
					if (!editor || disabled) return;
					// If the click landed on the ProseMirror surface (or a
					// child of it) tiptap already handles focus + caret
					// placement. Only step in when the click is in the
					// surrounding wrapper / padding so we don't fight the
					// editor's own selection logic.
					const target = e.target as HTMLElement | null;
					if (target?.closest(".ProseMirror")) return;
					editor.chain().focus("end").run();
				}}
			>
				<EditorContent
					editor={editor}
					className="tiptap-content min-h-[180px] flex-1 px-3 py-2 text-sm"
				/>
			</div>
			{!hideFooter && (
				<div className="flex items-center justify-between border-t px-3 py-2">
					<span className="text-xs text-muted-foreground">
						{charCount?.characters() ?? 0} / {maxLength}
					</span>
					<Button
						size="sm"
						onClick={handleSubmit}
						disabled={disabled || submitting || !canSubmitProp}
					>
						{submitting ? "提交中..." : "提交"}
					</Button>
				</div>
			)}
		</div>
	);
});
