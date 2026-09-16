"use client";

import { Button, LayerCard } from "@nocoo/basalt";
import { CircleDot, RotateCcw, Save } from "lucide-react";

export function AdminSaveBar({
	dirty,
	saving,
	onReset,
	onSave,
}: {
	dirty: boolean;
	saving: boolean;
	onReset: () => void;
	onSave: () => void;
}) {
	if (!dirty) return null;
	return (
		<LayerCard
			padding="none"
			className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border border-basalt-primary/20 p-3 shadow-lg"
		>
			<p role="status" className="flex items-center gap-2 text-sm">
				<CircleDot aria-hidden="true" className="h-4 w-4 text-basalt-primary" />
				有未保存的更改
			</p>
			<div className="flex gap-2">
				<Button variant="outline" size="sm" onClick={onReset} disabled={saving}>
					<RotateCcw aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
					重置更改
				</Button>
				<Button size="sm" onClick={onSave} disabled={saving}>
					<Save aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
					{saving ? "保存中..." : "保存更改"}
				</Button>
			</div>
		</LayerCard>
	);
}
