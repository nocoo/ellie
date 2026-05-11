"use client";

// components/forum/digest-dialog.tsx — Digest (featured) level selection dialog

import { Star, StarOff } from "lucide-react";
import { ModerationChoiceDialog, type ModerationChoiceOption } from "./moderation-choice-dialog";

interface DigestDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	currentLevel: number;
	onConfirm: (level: number) => void;
	loading?: boolean;
}

function renderStars(count: number) {
	if (count === 0) {
		return (
			<div className="flex items-center gap-0.5 w-16">
				<StarOff className="h-5 w-5 text-muted-foreground" />
			</div>
		);
	}
	return (
		<div className="flex items-center gap-0.5 w-16">
			{Array.from({ length: count }).map((_, i) => (
				<Star
					// biome-ignore lint/suspicious/noArrayIndexKey: static array
					key={i}
					className="h-4 w-4 fill-forum-accent text-forum-accent"
				/>
			))}
		</div>
	);
}

const DIGEST_OPTIONS: ModerationChoiceOption<number>[] = [
	{
		value: 0,
		label: "取消精华",
		description: "恢复普通主题",
		icon: renderStars(0),
	},
	{
		value: 1,
		label: "一级精华",
		description: "普通精华帖",
		icon: renderStars(1),
	},
	{
		value: 2,
		label: "二级精华",
		description: "优质精华帖",
		icon: renderStars(2),
	},
	{
		value: 3,
		label: "三级精华",
		description: "顶级精华帖",
		icon: renderStars(3),
	},
];

export function DigestDialog({
	open,
	onOpenChange,
	currentLevel,
	onConfirm,
	loading,
}: DigestDialogProps) {
	return (
		<ModerationChoiceDialog<number>
			open={open}
			onOpenChange={onOpenChange}
			title="设置精华"
			description="选择主题的精华级别"
			titleIcon={<Star className="h-5 w-5 text-primary" />}
			options={DIGEST_OPTIONS}
			defaultValue={currentLevel}
			onConfirm={onConfirm}
			loading={loading}
		/>
	);
}
