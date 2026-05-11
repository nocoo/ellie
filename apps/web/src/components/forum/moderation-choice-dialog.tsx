"use client";

/**
 * ModerationChoiceDialog — shared choice-dialog primitive for moderation
 * actions that present a list of mutually-exclusive options (e.g. sticky
 * level, digest level).
 *
 * This component owns only the UI structure: Dialog shell, option list with
 * selected/hover styling, and confirm/cancel footer. All domain logic
 * (options, icons, confirm callback) is passed in by the caller.
 */

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
import type { ReactNode } from "react";
import { useState } from "react";

export interface ModerationChoiceOption<T> {
	value: T;
	label: string;
	description: string;
	icon: ReactNode;
}

interface ModerationChoiceDialogProps<T> {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	titleIcon: ReactNode;
	options: ModerationChoiceOption<T>[];
	defaultValue: T;
	onConfirm: (value: T) => void;
	loading?: boolean;
}

export function ModerationChoiceDialog<T>({
	open,
	onOpenChange,
	title,
	description,
	titleIcon,
	options,
	defaultValue,
	onConfirm,
	loading,
}: ModerationChoiceDialogProps<T>) {
	const [selected, setSelected] = useState<T>(defaultValue);

	const handleConfirm = () => {
		onConfirm(selected);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{titleIcon}
						{title}
					</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				<div className="space-y-2 py-4">
					{options.map((option, idx) => (
						<button
							// biome-ignore lint/suspicious/noArrayIndexKey: static options array
							key={idx}
							type="button"
							className={cn(
								"w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left",
								selected === option.value
									? "border-primary bg-primary/5"
									: "border-border hover:border-primary/50",
							)}
							onClick={() => setSelected(option.value)}
						>
							{option.icon}
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
