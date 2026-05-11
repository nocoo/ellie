"use client";

// components/forum/sticky-dialog.tsx — Sticky level selection dialog

import type { StickyLevel } from "@/lib/moderation-api";
import { cn } from "@/lib/utils";
import { Pin, PinOff } from "lucide-react";
import { ModerationChoiceDialog, type ModerationChoiceOption } from "./moderation-choice-dialog";

interface StickyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	currentLevel: number;
	onConfirm: (level: StickyLevel) => void;
	loading?: boolean;
}

const STICKY_OPTIONS: ModerationChoiceOption<StickyLevel>[] = [
	{
		value: "none",
		label: "取消置顶",
		description: "恢复普通排序",
		icon: <PinOff className="h-5 w-5 text-muted-foreground" />,
	},
	{
		value: "forum",
		label: "版块置顶",
		description: "在本版块顶部显示",
		icon: <Pin className="h-5 w-5 text-primary" />,
	},
	{
		value: "global",
		label: "全局置顶",
		description: "在所有版块顶部显示",
		icon: <Pin className={cn("h-5 w-5", "text-forum-accent")} />,
	},
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
	return (
		<ModerationChoiceDialog<StickyLevel>
			open={open}
			onOpenChange={onOpenChange}
			title="设置置顶"
			description="选择主题的置顶级别"
			titleIcon={<Pin className="h-5 w-5 text-primary" />}
			options={STICKY_OPTIONS}
			defaultValue={levelToStickyLevel(currentLevel)}
			onConfirm={onConfirm}
			loading={loading}
		/>
	);
}
