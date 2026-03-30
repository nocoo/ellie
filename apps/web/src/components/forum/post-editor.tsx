"use client";

// components/forum/post-editor.tsx — Rich text editor (Tiptap)
// Ref: 04e §RichTextEditor — toolbar + editor + character count

import { EmojiPicker } from "@/components/forum/emoji-picker";
import { Button } from "@/components/ui/button";
import CharacterCount from "@tiptap/extension-character-count";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback } from "react";

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
}

// ---------------------------------------------------------------------------
// Toolbar toggle button
// ---------------------------------------------------------------------------

function ToolbarButton({
	active,
	onClick,
	children,
	title,
}: {
	active?: boolean;
	onClick: () => void;
	children: React.ReactNode;
	title: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			className={`inline-flex h-7 w-7 items-center justify-center rounded text-xs font-medium transition-colors ${
				active ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
			}`}
		>
			{children}
		</button>
	);
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function Toolbar({ editor }: { editor: Editor }) {
	return (
		<div className="flex items-center gap-0.5 border-b px-2 py-1 flex-wrap">
			{/* Formatting */}
			<ToolbarButton
				active={editor.isActive("bold")}
				onClick={() => editor.chain().focus().toggleBold().run()}
				title="粗体"
			>
				B
			</ToolbarButton>
			<ToolbarButton
				active={editor.isActive("italic")}
				onClick={() => editor.chain().focus().toggleItalic().run()}
				title="斜体"
			>
				<span className="italic">I</span>
			</ToolbarButton>
			<ToolbarButton
				active={editor.isActive("underline")}
				onClick={() => editor.chain().focus().toggleUnderline().run()}
				title="下划线"
			>
				U
			</ToolbarButton>

			<span className="mx-1 h-4 w-px bg-border" />

			{/* Headings */}
			<ToolbarButton
				active={editor.isActive("heading", { level: 2 })}
				onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
				title="标题 2"
			>
				H2
			</ToolbarButton>
			<ToolbarButton
				active={editor.isActive("heading", { level: 3 })}
				onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
				title="标题 3"
			>
				H3
			</ToolbarButton>

			<span className="mx-1 h-4 w-px bg-border" />

			{/* Lists */}
			<ToolbarButton
				active={editor.isActive("bulletList")}
				onClick={() => editor.chain().focus().toggleBulletList().run()}
				title="无序列表"
			>
				UL
			</ToolbarButton>
			<ToolbarButton
				active={editor.isActive("orderedList")}
				onClick={() => editor.chain().focus().toggleOrderedList().run()}
				title="有序列表"
			>
				OL
			</ToolbarButton>

			<span className="mx-1 h-4 w-px bg-border" />

			{/* Blockquote & Code */}
			<ToolbarButton
				active={editor.isActive("blockquote")}
				onClick={() => editor.chain().focus().toggleBlockquote().run()}
				title="引用"
			>
				&quot;
			</ToolbarButton>
			<ToolbarButton
				active={editor.isActive("codeBlock")}
				onClick={() => editor.chain().focus().toggleCodeBlock().run()}
				title="代码块"
			>
				{"</>"}
			</ToolbarButton>

			<span className="mx-1 h-4 w-px bg-border" />

			{/* Link & Emoji */}
			<ToolbarButton
				onClick={() => {
					const url = window.prompt("输入链接地址:");
					if (url) {
						editor.chain().focus().setLink({ href: url }).run();
					}
				}}
				title="插入链接"
			>
				🔗
			</ToolbarButton>
			<EmojiPicker onSelect={(emoji) => editor.chain().focus().insertContent(emoji).run()} />
		</div>
	);
}

// ---------------------------------------------------------------------------
// PostEditor
// ---------------------------------------------------------------------------

const MAX_LENGTH = 50000;

export function PostEditor({
	initialContent,
	onSubmit,
	placeholder = "输入内容...",
	maxLength = MAX_LENGTH,
	disabled = false,
	subject,
	onSubjectChange,
	submitting = false,
	canSubmit: canSubmitProp = true,
}: PostEditorProps) {
	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				heading: { levels: [2, 3, 4] },
			}),
			Link.configure({ openOnClick: false }),
			Placeholder.configure({ placeholder }),
			CharacterCount.configure({ limit: maxLength }),
		],
		content: initialContent ?? "",
		editable: !disabled,
	});

	const handleSubmit = useCallback(() => {
		if (!editor || disabled || submitting) return;
		onSubmit(editor.getHTML());
	}, [editor, disabled, submitting, onSubmit]);

	const charCount = editor?.storage.characterCount;

	return (
		<div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
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

			{/* Editor area */}
			<EditorContent editor={editor} className="tiptap-content min-h-[120px] px-3 py-2 text-sm" />

			{/* Footer */}
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
		</div>
	);
}
