"use client";

// components/forum/sticky-dialog.tsx — Sticky level selection dialog

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { StickyLevel } from "@/lib/moderation-api";
import { cn } from "@/lib/utils";
import { Pin, PinOff } from "lucide-react";
import { useState } from "react";

interface StickyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	currentLevel: number;
	onConfirm: (level: StickyLevel) => void;
	loading?: boolean;
}

const STICKY_OPTIONS: { level: StickyLevel; label: string; description: string }[] = [
	{ level: "none", label: "取消置顶", description: "恢复普通排序" },
	{ level: "forum", label: "版块置顶", description: "在本版块顶部显示" },
	{ level: "global", label: "全局置顶", description: "在所有版块顶部显示" },
];

function levelToStickyLevel(level: number): StickyLevel {
	if (level === 1) return "forum";
	if (level === 2) return "global";
	return "none";
}

export function StickyDialog({
	open,
	onOpenChange,
	currentLevel,
	onConfirm,
	loading,
}: StickyDialogProps) {
	const [selected, setSelected] = useState<StickyLevel>(levelToStickyLevel(currentLevel));

	const handleConfirm = () => {
		onConfirm(selected);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Pin className="h-5 w-5 text-primary" />
						设置置顶
					</DialogTitle>
					<DialogDescription>选择主题的置顶级别</DialogDescription>
				</DialogHeader>

				<div className="space-y-2 py-4">
					{STICKY_OPTIONS.map((option) => (
						<button
							key={option.level}
							type="button"
							className={cn(
								"w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left",
								selected === option.level
									? "border-primary bg-primary/5"
									: "border-border hover:border-primary/50",
							)}
							onClick={() => setSelected(option.level)}
						>
							{option.level === "none" ? (
								<PinOff className="h-5 w-5 text-muted-foreground" />
							) : (
								<Pin
									className={cn(
										"h-5 w-5",
										option.level === "global" ? "text-orange-500" : "text-blue-500",
									)}
								/>
							)}
							<div className="flex-1">
								<div className="font-medium">{option.label}</div>
								<div className="text-sm text-muted-foreground">{option.description}</div>
							</div>
						</button>
					))}
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
						取消
					</Button>
					<Button onClick={handleConfirm} disabled={loading}>
						{loading ? "处理中..." : "确定"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
