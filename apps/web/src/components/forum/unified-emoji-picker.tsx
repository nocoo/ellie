"use client";

// Unified emoji picker combining Unicode emojis and forum smileys
// Features: Tab switching, search, recent usage tracking with localStorage

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SMILEY_PACKS, getSmileyImageUrl } from "@/lib/smiley";
import { cn } from "@/lib/utils";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { Search, Smile } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECENT_KEY = "ellie_recent_emojis";
const MAX_RECENT = 16;

type EmojiTab = "unicode" | "forum" | "recent";

interface RecentEmoji {
	type: "unicode" | "forum";
	value: string; // native emoji or smiley code
	pack?: string; // for forum smileys
	file?: string; // for forum smileys
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function loadRecent(): RecentEmoji[] {
	if (typeof window === "undefined") return [];
	try {
		const stored = localStorage.getItem(RECENT_KEY);
		return stored ? JSON.parse(stored) : [];
	} catch {
		return [];
	}
}

function saveRecent(items: RecentEmoji[]) {
	if (typeof window === "undefined") return;
	try {
		localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, MAX_RECENT)));
	} catch {
		// Ignore storage errors
	}
}

function addToRecent(emoji: RecentEmoji, current: RecentEmoji[]): RecentEmoji[] {
	// Remove duplicate if exists
	const filtered = current.filter((e) => !(e.type === emoji.type && e.value === emoji.value));
	// Add to front
	return [emoji, ...filtered].slice(0, MAX_RECENT);
}

// ---------------------------------------------------------------------------
// Forum smiley tabs
// ---------------------------------------------------------------------------

const FORUM_TABS = [
	{ id: "default", name: "默认" },
	{ id: "coolmonkey", name: "酷猴" },
	{ id: "comcom", name: "兔斯基" },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface UnifiedEmojiPickerProps {
	onSelect: (emoji: string) => void;
}

export function UnifiedEmojiPicker({ onSelect }: UnifiedEmojiPickerProps) {
	const [open, setOpen] = useState(false);
	// Forum tab (with default pack) is the initial view — zheng-li wants
	// users to land on the legacy default smiley group when opening the
	// picker, since that's what posts most commonly use.
	const [activeTab, setActiveTab] = useState<EmojiTab>("forum");
	const [forumPack, setForumPack] = useState<string>("default");
	const [recent, setRecent] = useState<RecentEmoji[]>([]);
	const [searchQuery, setSearchQuery] = useState("");

	// Load recent on mount
	useEffect(() => {
		setRecent(loadRecent());
	}, []);

	// Handle Unicode emoji selection
	const handleUnicodeSelect = useCallback(
		(emoji: { native: string }) => {
			const newRecent = addToRecent({ type: "unicode", value: emoji.native }, recent);
			setRecent(newRecent);
			saveRecent(newRecent);
			onSelect(emoji.native);
			setOpen(false);
		},
		[onSelect, recent],
	);

	// Handle forum smiley selection
	const handleForumSelect = useCallback(
		(code: string, pack: string, file: string) => {
			const newRecent = addToRecent({ type: "forum", value: code, pack, file }, recent);
			setRecent(newRecent);
			saveRecent(newRecent);
			onSelect(code);
			setOpen(false);
		},
		[onSelect, recent],
	);

	// Handle recent emoji selection
	const handleRecentSelect = useCallback(
		(item: RecentEmoji) => {
			// Move to front of recent
			const newRecent = addToRecent(item, recent);
			setRecent(newRecent);
			saveRecent(newRecent);
			onSelect(item.value);
			setOpen(false);
		},
		[onSelect, recent],
	);

	// Get current forum smileys filtered by search
	const forumSmileys = SMILEY_PACKS[forumPack] ?? [];
	const filteredSmileys = searchQuery
		? forumSmileys.filter((s) => s.code.toLowerCase().includes(searchQuery.toLowerCase()))
		: forumSmileys;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger
					render={
						<PopoverTrigger
							aria-label="插入表情"
							className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
						>
							<Smile className="h-3.5 w-3.5" />
						</PopoverTrigger>
					}
				/>
				<TooltipContent>插入表情</TooltipContent>
			</Tooltip>
			<PopoverContent className="w-[320px] p-0 overflow-hidden" align="end" sideOffset={8}>
				{/* Main tabs */}
				<div className="flex border-b bg-muted/30">
					<TabButton active={activeTab === "forum"} onClick={() => setActiveTab("forum")}>
						<span className="mr-1.5">🎭</span>
						论坛
					</TabButton>
					<TabButton active={activeTab === "unicode"} onClick={() => setActiveTab("unicode")}>
						<span className="mr-1.5">😀</span>
						Emoji
					</TabButton>
					<TabButton active={activeTab === "recent"} onClick={() => setActiveTab("recent")}>
						<span className="mr-1.5">⏰</span>
						最近
					</TabButton>
				</div>

				{/* Content based on active tab */}
				{activeTab === "unicode" && (
					<Picker
						data={data}
						onEmojiSelect={handleUnicodeSelect}
						locale="zh"
						theme="auto"
						previewPosition="none"
						skinTonePosition="search"
						navPosition="bottom"
						perLine={8}
						emojiSize={22}
						emojiButtonSize={32}
					/>
				)}

				{activeTab === "forum" && (
					<div className="flex flex-col">
						{/* Forum pack tabs */}
						<div className="flex gap-1 px-2 py-1.5 border-b bg-muted/20">
							{FORUM_TABS.map((tab) => (
								<button
									key={tab.id}
									type="button"
									onClick={() => setForumPack(tab.id)}
									className={cn(
										"px-2 py-0.5 text-xs rounded transition-colors",
										forumPack === tab.id
											? "bg-primary text-primary-foreground"
											: "text-muted-foreground hover:text-foreground hover:bg-muted",
									)}
								>
									{tab.name}
								</button>
							))}
						</div>

						{/* Search bar */}
						<div className="px-2 py-1.5 border-b">
							<div className="relative">
								<Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
								<input
									type="text"
									placeholder="搜索表情..."
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									className="w-full h-7 pl-7 pr-2 text-xs bg-muted/50 rounded border-0 outline-none focus:ring-1 focus:ring-primary/50"
								/>
							</div>
						</div>

						{/* Smiley grid */}
						<div className="grid grid-cols-8 gap-0.5 p-2 max-h-[200px] overflow-y-auto">
							{filteredSmileys.map((smiley) => (
								<button
									key={smiley.code}
									type="button"
									onClick={() => handleForumSelect(smiley.code, forumPack, smiley.file)}
									className="w-8 h-8 flex items-center justify-center rounded hover:bg-accent transition-colors"
									title={smiley.code}
								>
									<img
										src={getSmileyImageUrl(forumPack, smiley.file)}
										alt={smiley.code}
										className="w-6 h-6 object-contain"
										loading="lazy"
									/>
								</button>
							))}
							{filteredSmileys.length === 0 && (
								<div className="col-span-8 py-4 text-center text-xs text-muted-foreground">
									没有找到表情
								</div>
							)}
						</div>
					</div>
				)}

				{activeTab === "recent" && (
					<div className="p-3">
						{recent.length > 0 ? (
							<div className="grid grid-cols-8 gap-1">
								{recent.map((item, idx) => (
									<button
										key={`${item.type}-${item.value}-${idx}`}
										type="button"
										onClick={() => handleRecentSelect(item)}
										className="w-8 h-8 flex items-center justify-center rounded hover:bg-accent transition-colors text-lg"
										title={item.value}
									>
										{item.type === "unicode" ? (
											item.value
										) : (
											<img
												src={getSmileyImageUrl(item.pack ?? "default", item.file ?? "")}
												alt={item.value}
												className="w-6 h-6 object-contain"
												loading="lazy"
											/>
										)}
									</button>
								))}
							</div>
						) : (
							<div className="py-8 text-center text-sm text-muted-foreground">
								暂无最近使用
								<p className="text-xs mt-1">选择表情后会显示在这里</p>
							</div>
						)}
					</div>
				)}

				{/* Quick access bar (recent) */}
				{activeTab !== "recent" && recent.length > 0 && (
					<div className="border-t px-2 py-1.5 bg-muted/20">
						<div className="flex items-center gap-0.5">
							<span className="text-xs text-muted-foreground mr-1.5">最近：</span>
							{recent.slice(0, 8).map((item, idx) => (
								<button
									key={`quick-${item.type}-${item.value}-${idx}`}
									type="button"
									onClick={() => handleRecentSelect(item)}
									className="w-6 h-6 flex items-center justify-center rounded hover:bg-accent transition-colors text-sm"
									title={item.value}
								>
									{item.type === "unicode" ? (
										item.value
									) : (
										<img
											src={getSmileyImageUrl(item.pack ?? "default", item.file ?? "")}
											alt={item.value}
											className="w-4 h-4 object-contain"
											loading="lazy"
										/>
									)}
								</button>
							))}
						</div>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

// ---------------------------------------------------------------------------
// Tab button component
// ---------------------------------------------------------------------------

function TabButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex-1 py-2 text-xs font-medium transition-colors",
				active
					? "text-foreground border-b-2 border-primary"
					: "text-muted-foreground hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}
