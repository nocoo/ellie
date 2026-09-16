"use client";

import { Button, LayerCard, Separator } from "@nocoo/basalt";
import { X } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchAction {
	key: string;
	label: string;
	variant?: "default" | "destructive" | "outline";
}

export interface AdminBatchBarProps {
	selectedCount: number;
	disabled?: boolean;
	actions: BatchAction[];
	onAction: (key: string) => void;
	onClear: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminBatchBar({
	selectedCount,
	disabled = false,
	actions,
	onAction,
	onClear,
}: AdminBatchBarProps) {
	if (selectedCount === 0) return null;

	return (
		<section
			className="fixed bottom-6 left-1/2 z-50 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2"
			aria-label="批量操作"
		>
			<LayerCard
				padding="none"
				className="flex flex-wrap items-center justify-center gap-3 px-4 py-2.5 shadow-lg [&>*]:shrink-0"
			>
				<span className="text-sm font-medium text-basalt-foreground">{selectedCount} 已选</span>
				<Separator orientation="vertical" className="h-4" />
				{actions.map((action) => (
					<Button
						key={action.key}
						variant={action.variant ?? "default"}
						size="sm"
						disabled={disabled}
						onClick={() => onAction(action.key)}
					>
						{action.label}
					</Button>
				))}
				<Button
					type="button"
					disabled={disabled}
					onClick={onClear}
					className="ml-1 h-7 w-7"
					aria-label="清除选择"
					variant="ghost"
					size="icon"
				>
					<X className="h-4 w-4" />
				</Button>
			</LayerCard>
		</section>
	);
}
