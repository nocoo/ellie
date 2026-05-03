"use client";

// SmileyPicker — popover trigger + tabbed smiley panel for PostEditor.
//
// Old behaviour: a permanently-mounted panel pinned to the bottom of
// the editor, eating ~140px of vertical space inside reply / new-thread
// dialogs. The B4 dialog overhaul replaces that with an Insert/Smiley
// toolbar button so the editor body actually gets the height it needs.
// `SmileyPanelContent` is exported for callers (or tests) that want the
// raw grid without the popover wrapper.

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SMILEY_PACKS, getSmileyImageUrl } from "@/lib/smiley";
import { cn } from "@/lib/utils";
import { Smile as SmileIcon } from "lucide-react";
import { useState } from "react";

const TABS = [
	{ id: "default", name: "默认" },
	{ id: "coolmonkey", name: "酷猴" },
	{ id: "comcom", name: "兔斯基" },
] as const;

interface SmileyPanelContentProps {
	onSelect: (code: string) => void;
	className?: string;
}

/**
 * Raw smiley grid — no popover, no outer border. Use this when you want
 * to embed the picker into another container (or a test harness).
 */
export function SmileyPanelContent({ onSelect, className }: SmileyPanelContentProps) {
	const [activeTab, setActiveTab] = useState<string>("default");
	const smileys = SMILEY_PACKS[activeTab] ?? [];

	return (
		<div className={cn("flex flex-col", className)}>
			{/* Tab buttons */}
			<div className="flex gap-1 px-2 py-1.5 border-b bg-muted/30">
				{TABS.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => setActiveTab(tab.id)}
						className={cn(
							"px-2.5 py-1 text-xs rounded-md transition-colors",
							activeTab === tab.id
								? "bg-primary text-primary-foreground"
								: "text-muted-foreground hover:text-foreground hover:bg-muted",
						)}
					>
						{tab.name}
					</button>
				))}
			</div>

			{/* Smiley grid */}
			<div className="grid grid-cols-12 gap-0.5 p-2 max-h-[220px] overflow-y-auto">
				{smileys.map((smiley) => (
					<button
						key={smiley.code}
						type="button"
						onClick={() => onSelect(smiley.code)}
						className={cn(
							"w-7 h-7 flex items-center justify-center",
							"rounded hover:bg-accent transition-colors",
						)}
						title={smiley.code}
					>
						<img
							src={getSmileyImageUrl(activeTab, smiley.file)}
							alt={smiley.code}
							className="w-5 h-5 object-contain"
							loading="lazy"
						/>
					</button>
				))}
			</div>
		</div>
	);
}

interface SmileyPickerProps {
	onSelect: (code: string) => void;
}

/**
 * Toolbar button that opens the smiley grid in a popover. Used by
 * `PostEditor`'s Insert group.
 */
export function SmileyPicker({ onSelect }: SmileyPickerProps) {
	return (
		<Popover>
			<PopoverTrigger
				render={
					<button
						type="button"
						aria-label="插入表情"
						title="插入表情"
						className="inline-flex h-7 w-7 items-center justify-center rounded text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
					>
						<SmileIcon className="h-3.5 w-3.5" />
					</button>
				}
			/>
			<PopoverContent className="w-auto p-0" align="end" sideOffset={8}>
				<SmileyPanelContent onSelect={onSelect} />
			</PopoverContent>
		</Popover>
	);
}
