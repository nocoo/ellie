"use client";

// components/forum/highlight-dialog.tsx — Thread highlight color/style dialog

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { HighlightOptions } from "@/lib/moderation-api";
import { cn } from "@/lib/utils";
import { decodeHighlight } from "@ellie/types";
import { Highlighter } from "lucide-react";
import { useEffect, useState } from "react";

interface HighlightDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	currentHighlight: number;
	onConfirm: (options: HighlightOptions) => void;
	loading?: boolean;
}

const PRESET_COLORS = [
	{ color: null, label: "无" },
	{ color: "#FF0000", label: "红色" },
	{ color: "#FF6600", label: "橙色" },
	{ color: "#008000", label: "绿色" },
	{ color: "#0000FF", label: "蓝色" },
	{ color: "#9900FF", label: "紫色" },
	{ color: "#FF1493", label: "粉色" },
	{ color: "#8B4513", label: "棕色" },
];

export function HighlightDialog({
	open,
	onOpenChange,
	currentHighlight,
	onConfirm,
	loading,
}: HighlightDialogProps) {
	const decoded = decodeHighlight(currentHighlight);
	const [selectedColor, setSelectedColor] = useState<string | null>(decoded?.color ?? null);
	const [bold, setBold] = useState(decoded?.bold ?? false);
	const [italic, setItalic] = useState(decoded?.italic ?? false);
	const [underline, setUnderline] = useState(decoded?.underline ?? false);

	// Reset state when dialog opens
	useEffect(() => {
		if (open) {
			const d = decodeHighlight(currentHighlight);
			setSelectedColor(d?.color ?? null);
			setBold(d?.bold ?? false);
			setItalic(d?.italic ?? false);
			setUnderline(d?.underline ?? false);
		}
	}, [open, currentHighlight]);

	const handleConfirm = () => {
		onConfirm({
			color: selectedColor,
			bold,
			italic,
			underline,
		});
	};

	const previewStyle: React.CSSProperties = {
		color: selectedColor || "inherit",
		fontWeight: bold ? "bold" : "normal",
		fontStyle: italic ? "italic" : "normal",
		textDecoration: underline ? "underline" : "none",
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Highlighter className="h-5 w-5 text-primary" />
						设置高亮
					</DialogTitle>
					<DialogDescription>选择主题标题的颜色和样式</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{/* Color selection */}
					<div>
						<div className="text-sm font-medium mb-2">颜色</div>
						<div className="flex flex-wrap gap-2">
							{PRESET_COLORS.map((item) => (
								<button
									key={item.color ?? "none"}
									type="button"
									className={cn(
										"w-8 h-8 rounded-full border-2 transition-all",
										selectedColor === item.color
											? "border-primary ring-2 ring-primary/30"
											: "border-border hover:border-primary/50",
									)}
									style={{
										backgroundColor: item.color || "transparent",
									}}
									onClick={() => setSelectedColor(item.color)}
									title={item.label}
								>
									{item.color === null && (
										<span className="text-xs text-muted-foreground">无</span>
									)}
								</button>
							))}
						</div>
					</div>

					{/* Style options */}
					<div>
						<div className="text-sm font-medium mb-2">样式</div>
						<div className="flex gap-4">
							<label className="flex items-center gap-2 cursor-pointer">
								<Checkbox checked={bold} onCheckedChange={(v) => setBold(!!v)} />
								<span className="text-sm font-bold">粗体</span>
							</label>
							<label className="flex items-center gap-2 cursor-pointer">
								<Checkbox checked={italic} onCheckedChange={(v) => setItalic(!!v)} />
								<span className="text-sm italic">斜体</span>
							</label>
							<label className="flex items-center gap-2 cursor-pointer">
								<Checkbox checked={underline} onCheckedChange={(v) => setUnderline(!!v)} />
								<span className="text-sm underline">下划线</span>
							</label>
						</div>
					</div>

					{/* Preview */}
					<div>
						<div className="text-sm font-medium mb-2">预览</div>
						<div className="p-3 rounded-lg border border-border bg-muted/30">
							<span style={previewStyle}>这是一个示例标题</span>
						</div>
					</div>
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
