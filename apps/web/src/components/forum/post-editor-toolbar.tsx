"use client";

import { type Editor, useEditorState } from "@tiptap/react";
import {
	Bold,
	ChevronDown,
	Code,
	CodeXml,
	Heading2,
	Heading3,
	Image as ImageIcon,
	Italic,
	Link as LinkIcon,
	List,
	ListOrdered,
	Loader2,
	Pilcrow,
	Quote,
	Redo2,
	RemoveFormatting,
	Strikethrough,
	Underline,
	Undo2,
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useId, useState } from "react";
import { UnifiedEmojiPicker } from "@/components/forum/unified-emoji-picker";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { emojiTokenToInsertion } from "@/viewmodels/forum/post-editor";
import { sanitizeUrl } from "@/viewmodels/forum/url-sanitize";

function Tool({
	active,
	onClick,
	children,
	title,
	shortcut,
	disabled,
}: {
	active?: boolean;
	onClick: () => void;
	children: ReactNode;
	title: string;
	shortcut?: string;
	disabled?: boolean;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						onClick={onClick}
						aria-label={title}
						aria-pressed={active}
						disabled={disabled}
						className={cn("composer-tool", active && "bg-primary/10 text-primary")}
					>
						{children}
					</Button>
				}
			/>
			<TooltipContent className="flex items-center gap-3">
				{title}
				{shortcut && <span className="opacity-65">{shortcut}</span>}
			</TooltipContent>
		</Tooltip>
	);
}

function Divider() {
	return <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

function LinkPopover({ editor, disabled }: { editor: Editor; disabled: boolean }) {
	const id = useId();
	const [open, setOpen] = useState(false);
	const [url, setUrl] = useState("");
	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);

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
			if (from === to && !editor.isActive("link")) {
				chain
					.insertContent({
						type: "text",
						text: trimmedText || sanitized.url,
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
		editor.chain().focus().extendMarkRange("link").unsetLink().run();
		setOpen(false);
	}, [editor]);

	const isLinkActive = useEditorState({
		editor,
		selector: ({ editor }) => editor.isActive("link"),
	});

	return (
		<Popover open={open && !disabled} onOpenChange={handleOpenChange}>
			<Tooltip>
				<TooltipTrigger
					render={
						<PopoverTrigger
							render={
								<Button
									type="button"
									aria-label="插入链接"
									disabled={disabled}
									variant="ghost"
									size="icon-sm"
									aria-pressed={isLinkActive}
									className={cn("composer-tool", isLinkActive && "bg-primary/10 text-primary")}
								>
									<LinkIcon className="h-4 w-4" />
								</Button>
							}
						/>
					}
				/>
				<TooltipContent>插入链接</TooltipContent>
			</Tooltip>
			<PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
				<form onSubmit={handleSubmit} className="flex flex-col gap-2">
					<label className="text-xs text-muted-foreground" htmlFor={`${id}-url`}>
						链接地址
					</label>
					<Input
						id={`${id}-url`}
						type="text"
						placeholder="https://example.com"
						value={url}
						onChange={(e) => {
							setUrl(e.target.value);
							setError(null);
						}}
						autoFocus
					/>
					<label className="text-xs text-muted-foreground" htmlFor={`${id}-text`}>
						显示文字（可选，未选中文本时使用）
					</label>
					<Input
						id={`${id}-text`}
						type="text"
						placeholder="链接显示的文字"
						value={text}
						onChange={(e) => setText(e.target.value)}
					/>
					{error && (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					)}
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

export function PostEditorToolbar({
	editor,
	disabled,
	uploading,
	onImage,
}: {
	editor: Editor;
	disabled: boolean;
	uploading: boolean;
	onImage: () => void;
}) {
	const active = useEditorState({
		editor,
		selector: ({ editor }) => ({
			block: editor.isActive("heading", { level: 2 })
				? "h2"
				: editor.isActive("heading", { level: 3 })
					? "h3"
					: "p",
			bold: editor.isActive("bold"),
			italic: editor.isActive("italic"),
			underline: editor.isActive("underline"),
			strike: editor.isActive("strike"),
			code: editor.isActive("code"),
			blockquote: editor.isActive("blockquote"),
			codeBlock: editor.isActive("codeBlock"),
			bulletList: editor.isActive("bulletList"),
			orderedList: editor.isActive("orderedList"),
			undo: editor.can().undo(),
			redo: editor.can().redo(),
		}),
	});
	return (
		<TooltipProvider delay={350}>
			<fieldset
				disabled={disabled}
				className="flex min-w-0 flex-wrap items-center gap-0.5 border-b border-border bg-muted/25 p-1.5 sm:px-2"
			>
				<legend className="sr-only">文本格式</legend>
				<DropdownMenu>
					<DropdownMenuTrigger
						disabled={disabled}
						render={
							<Button
								variant="ghost"
								size="sm"
								aria-label="段落样式"
								className="gap-2 font-normal"
							/>
						}
					>
						{active.block === "h2" ? (
							<Heading2 className="size-4" />
						) : active.block === "h3" ? (
							<Heading3 className="size-4" />
						) : (
							<Pilcrow className="size-4" />
						)}
						{active.block === "h2" ? "大标题" : active.block === "h3" ? "小标题" : "正文"}
						<ChevronDown className="size-3.5 text-muted-foreground" />
					</DropdownMenuTrigger>
					<DropdownMenuContent className="w-40">
						<DropdownMenuRadioGroup
							value={active.block}
							onValueChange={(value) => {
								if (value === "p") editor.chain().focus().setParagraph().run();
								else
									editor
										.chain()
										.focus()
										.setHeading({ level: value === "h2" ? 2 : 3 })
										.run();
							}}
						>
							<DropdownMenuRadioItem value="p" closeOnClick>
								<Pilcrow />
								正文
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="h2" closeOnClick>
								<Heading2 />
								大标题
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="h3" closeOnClick>
								<Heading3 />
								小标题
							</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenu>
				<Divider />
				<Tool
					title="粗体"
					shortcut="Ctrl / ⌘ B"
					active={active.bold}
					onClick={() => editor.chain().focus().toggleBold().run()}
				>
					<Bold />
				</Tool>
				<Tool
					title="斜体"
					shortcut="Ctrl / ⌘ I"
					active={active.italic}
					onClick={() => editor.chain().focus().toggleItalic().run()}
				>
					<Italic />
				</Tool>
				<Tool
					title="下划线"
					shortcut="Ctrl / ⌘ U"
					active={active.underline}
					onClick={() => editor.chain().focus().toggleUnderline().run()}
				>
					<Underline />
				</Tool>
				<Tool
					title="删除线"
					active={active.strike}
					onClick={() => editor.chain().focus().toggleStrike().run()}
				>
					<Strikethrough />
				</Tool>
				<Tool
					title="行内代码"
					active={active.code}
					onClick={() => editor.chain().focus().toggleCode().run()}
				>
					<Code />
				</Tool>
				<Divider />
				<Tool
					title="无序列表"
					active={active.bulletList}
					onClick={() => editor.chain().focus().toggleBulletList().run()}
				>
					<List />
				</Tool>
				<Tool
					title="有序列表"
					active={active.orderedList}
					onClick={() => editor.chain().focus().toggleOrderedList().run()}
				>
					<ListOrdered />
				</Tool>
				<Tool
					title="引用"
					active={active.blockquote}
					onClick={() => editor.chain().focus().toggleBlockquote().run()}
				>
					<Quote />
				</Tool>
				<Tool
					title="代码块"
					active={active.codeBlock}
					onClick={() => editor.chain().focus().toggleCodeBlock().run()}
				>
					<CodeXml />
				</Tool>
				<Divider />
				<LinkPopover editor={editor} disabled={disabled} />
				<Tool title="插入图片" disabled={disabled || uploading} onClick={onImage}>
					{uploading ? <Loader2 className="animate-spin" /> : <ImageIcon />}
				</Tool>
				<UnifiedEmojiPicker
					disabled={disabled}
					onSelect={(token) =>
						editor.chain().focus().insertContent(emojiTokenToInsertion(token)).run()
					}
				/>
				<Divider />
				<Tool
					title="撤销"
					shortcut="Ctrl / ⌘ Z"
					disabled={!active.undo}
					onClick={() => editor.chain().focus().undo().run()}
				>
					<Undo2 />
				</Tool>
				<Tool
					title="重做"
					shortcut="Ctrl / ⌘ ⇧ Z"
					disabled={!active.redo}
					onClick={() => editor.chain().focus().redo().run()}
				>
					<Redo2 />
				</Tool>
				<Tool
					title="清除格式"
					onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
				>
					<RemoveFormatting />
				</Tool>
			</fieldset>
		</TooltipProvider>
	);
}
