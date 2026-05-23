"use client";

// SmileyPanelContent — raw tabbed smiley grid (no popover).
//
// History: this used to also export a `SmileyPicker` popover wrapper
// that was mounted directly in `PostEditor`'s toolbar. After the
// task-#4 unification (req msg=0c9265c6) the editor now shows a single
// emoji entry point — `UnifiedEmojiPicker` — which embeds Forum
// (default / coolmonkey / comcom) + Unicode + Recent in one panel.
// `SmileyPanelContent` is kept as a reusable primitive: it is still
// useful for callers that want the raw forum-smiley grid without the
// popover chrome (e.g. an in-page embed or a test harness).

import { SMILEY_PACKS, getSmileyImageUrl } from "@/lib/smiley";
import { cn } from "@/lib/utils";
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
