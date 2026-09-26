"use client";

// components/forum/digest-dialog.tsx — Digest (featured) level selection dialog

import { StarOff } from "lucide-react";
import { DigestIcon } from "./digest-icon";
import { ModerationChoiceDialog, type ModerationChoiceOption } from "./moderation-choice-dialog";

interface DigestDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	currentLevel: number;
	onConfirm: (level: number) => void;
	loading?: boolean;
}

const DIGEST_OPTIONS: ModerationChoiceOption<number>[] = [
	{
		value: 0,
		label: "取消精华",
		description: "恢复普通主题",
		icon: <StarOff className="h-5 w-5 text-muted-foreground" />,
	},
	{
		value: 1,
		label: "一级精华",
		description: "普通精华帖",
		icon: <DigestIcon level={1} />,
	},
	{
		value: 2,
		label: "二级精华",
		description: "优质精华帖",
		icon: <DigestIcon level={2} />,
	},
	{
		value: 3,
		label: "三级精华",
		description: "顶级精华帖",
		icon: <DigestIcon level={3} />,
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
			titleIcon={<DigestIcon level={1} />}
			options={DIGEST_OPTIONS}
			defaultValue={currentLevel}
			onConfirm={onConfirm}
			loading={loading}
		/>
	);
}
