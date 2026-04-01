"use client";

// components/forum/digest-dialog.tsx — Digest (featured) level selection dialog

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Star, StarOff } from "lucide-react";
import { useState } from "react";

interface DigestDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	currentLevel: number;
	onConfirm: (level: number) => void;
	loading?: boolean;
}

const DIGEST_OPTIONS = [
	{ level: 0, label: "取消精华", description: "恢复普通帖子", stars: 0 },
	{ level: 1, label: "一级精华", description: "普通精华帖", stars: 1 },
	{ level: 2, label: "二级精华", description: "优质精华帖", stars: 2 },
	{ level: 3, label: "三级精华", description: "顶级精华帖", stars: 3 },
];

export function DigestDialog({
	open,
	onOpenChange,
	currentLevel,
	onConfirm,
	loading,
}: DigestDialogProps) {
	const [selected, setSelected] = useState(currentLevel);

	const handleConfirm = () => {
		onConfirm(selected);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Star className="h-5 w-5 text-primary" />
						设置精华
					</DialogTitle>
					<DialogDescription>选择主题的精华级别</DialogDescription>
				</DialogHeader>

				<div className="space-y-2 py-4">
					{DIGEST_OPTIONS.map((option) => (
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
							<div className="flex items-center gap-0.5 w-16">
								{option.stars === 0 ? (
									<StarOff className="h-5 w-5 text-muted-foreground" />
								) : (
									Array.from({ length: option.stars }).map((_, i) => (
										<Star
											// biome-ignore lint/suspicious/noArrayIndexKey: static array
											key={i}
											className="h-4 w-4 fill-yellow-400 text-yellow-400"
										/>
									))
								)}
							</div>
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
