"use client";

import { Button } from "@ellie/ui";
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
	actions: BatchAction[];
	onAction: (key: string) => void;
	onClear: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminBatchBar({ selectedCount, actions, onAction, onClear }: AdminBatchBarProps) {
	if (selectedCount === 0) return null;

	return (
		<div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-in slide-in-from-bottom-4 fade-in">
			<div className="flex items-center gap-3 rounded-xl bg-secondary px-4 py-2.5 shadow-lg">
				<span className="text-sm font-medium text-foreground">{selectedCount} 已选</span>
				<div className="h-4 w-px bg-border" />
				{actions.map((action) => (
					<Button
						key={action.key}
						variant={action.variant ?? "default"}
						size="sm"
						onClick={() => onAction(action.key)}
					>
						{action.label}
					</Button>
				))}
				<button
					type="button"
					onClick={onClear}
					className="ml-1 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
					aria-label="清除选择"
				>
					<X className="h-4 w-4" />
				</button>
			</div>
		</div>
	);
}
