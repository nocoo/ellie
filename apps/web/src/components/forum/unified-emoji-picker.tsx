"use client";

import { getSmileyImageUrl, SMILEY_PACKS } from "@ellie/shared/smiley";
import data from "@emoji-mart/data";
import zh from "@emoji-mart/data/i18n/zh.json";
import Picker from "@emoji-mart/react";
import { MessageCircle, Search, Smile } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/hooks/use-theme";
import {
	addRecentEmoji,
	loadRecentEmojis,
	type RecentEmoji,
	saveRecentEmojis,
} from "@/viewmodels/forum/emoji-picker";

interface UnifiedEmojiPickerProps {
	onSelect: (emoji: string) => void;
	disabled?: boolean;
}

export function UnifiedEmojiPicker({ onSelect, disabled = false }: UnifiedEmojiPickerProps) {
	const [open, setOpen] = useState(false);
	const [recent, setRecent] = useState<RecentEmoji[]>([]);
	const [searchQuery, setSearchQuery] = useState("");
	const { resolved } = useTheme();
	const smileys = SMILEY_PACKS.default.filter((item) =>
		item.code.toLowerCase().includes(searchQuery.toLowerCase()),
	);

	function select(item: RecentEmoji) {
		const next = addRecentEmoji(item, loadRecentEmojis());
		setRecent(next);
		saveRecentEmojis(next);
		onSelect(item.value);
		setOpen(false);
	}

	return (
		<Popover
			open={open && !disabled}
			onOpenChange={(next) => {
				if (next) {
					setRecent(loadRecentEmojis());
					setSearchQuery("");
				}
				setOpen(next);
			}}
		>
			<Tooltip>
				<TooltipTrigger
					render={
						<PopoverTrigger
							aria-label="插入表情"
							disabled={disabled}
							className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
						>
							<Smile className="h-4 w-4" />
						</PopoverTrigger>
					}
				/>
				<TooltipContent>插入表情</TooltipContent>
			</Tooltip>
			<PopoverContent
				className="w-80 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0"
				align="end"
				sideOffset={8}
			>
				<Tabs defaultValue="forum" className="w-full flex-col gap-0">
					<TabsList variant="line" className="h-9 w-full shrink-0 border-b bg-muted/30 p-0">
						<TabsTrigger
							value="forum"
							className="rounded-none border-b-2 data-active:border-b-primary after:bottom-0"
						>
							<MessageCircle aria-hidden="true" />
							论坛
						</TabsTrigger>
						<TabsTrigger
							value="unicode"
							className="rounded-none border-b-2 data-active:border-b-primary after:bottom-0"
						>
							<Smile aria-hidden="true" />
							Emoji
						</TabsTrigger>
					</TabsList>
					<div className="h-[min(20rem,calc(100dvh-12rem))] min-h-0 overflow-hidden">
						<TabsContent value="forum" className="flex h-full min-h-0 flex-col">
							<div className="shrink-0 px-3 py-2">
								<div className="relative">
									<Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
									<Input
										placeholder="搜索表情..."
										aria-label="搜索论坛表情"
										value={searchQuery}
										onChange={(event) => setSearchQuery(event.target.value)}
										className="h-8 pl-8 text-sm"
									/>
								</div>
							</div>
							<div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
								<div className="grid grid-cols-8">
									{smileys.map((item) => (
										<Button
											key={item.code}
											variant="ghost"
											size="icon"
											className="h-9 w-full"
											title={item.code}
											onClick={() =>
												select({
													type: "forum",
													value: item.code,
													pack: "default",
													file: item.file,
												})
											}
										>
											<img
												src={getSmileyImageUrl("default", item.file)}
												alt={item.code}
												className="size-6 object-contain"
												loading="lazy"
											/>
										</Button>
									))}
								</div>
								{smileys.length === 0 && (
									<p className="py-4 text-center text-sm text-muted-foreground">没有找到表情</p>
								)}
							</div>
						</TabsContent>
						<TabsContent value="unicode" className="forum-emoji-picker h-full min-h-0">
							<Picker
								data={data}
								i18n={zh}
								onEmojiSelect={(emoji: { native: string }) =>
									select({ type: "unicode", value: emoji.native })
								}
								locale="zh"
								theme={resolved}
								maxFrequentRows={0}
								previewPosition="none"
								skinTonePosition="search"
								navPosition="bottom"
								dynamicWidth
								perLine={8}
								emojiSize={24}
								emojiButtonSize={36}
							/>
						</TabsContent>
					</div>
				</Tabs>
				<section
					aria-label="最近使用的表情"
					className="flex h-12 shrink-0 items-center gap-2 border-t bg-muted/20 px-3 py-2"
				>
					<span className="shrink-0 text-xs text-muted-foreground">最近</span>
					{recent.length ? (
						<div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
							{recent.map((item) => (
								<Button
									key={`${item.type}:${item.value}`}
									variant="ghost"
									size="icon-sm"
									className="shrink-0 text-lg"
									title={item.value}
									onClick={() => select(item)}
								>
									{item.type === "unicode" ? (
										item.value
									) : (
										<img
											src={getSmileyImageUrl(item.pack, item.file)}
											alt={item.value}
											className="size-5 object-contain"
											loading="lazy"
										/>
									)}
								</Button>
							))}
						</div>
					) : (
						<p className="shrink-0 text-xs text-muted-foreground">使用过的表情会显示在这里</p>
					)}
				</section>
			</PopoverContent>
		</Popover>
	);
}
