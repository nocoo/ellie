"use client";

// SmileyPanel — tabbed smiley picker for PostEditor
// Displays traditional forum smileys from CDN (default, coolmonkey, comcom packs)

import { SMILEY_PACKS, getSmileyImageUrl } from "@/lib/smiley";
import { cn } from "@/lib/utils";
import { useState } from "react";

const TABS = [
	{ id: "default", name: "默认" },
	{ id: "coolmonkey", name: "酷猴" },
	{ id: "comcom", name: "兔斯基" },
] as const;

interface SmileyPanelProps {
	onSelect: (code: string) => void;
	className?: string;
}

export function SmileyPanel({ onSelect, className }: SmileyPanelProps) {
	const [activeTab, setActiveTab] = useState<string>("default");
	const smileys = SMILEY_PACKS[activeTab] ?? [];

	return (
		<div className={cn("border-t", className)}>
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
			<div className="grid grid-cols-12 gap-0.5 p-2 max-h-[100px] overflow-y-auto">
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
