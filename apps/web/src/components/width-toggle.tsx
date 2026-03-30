// components/width-toggle.tsx — Width mode toggle button
// Ref: 04f §2 — mirrors theme-toggle.tsx pattern

"use client";

import { type WidthMode, useWidthMode } from "@/hooks/use-width-mode";
import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "./ui/button";

const ICONS: Record<WidthMode, typeof Maximize2> = {
	centered: Maximize2,
	full: Minimize2,
};

const LABELS: Record<WidthMode, string> = {
	centered: "切换宽屏模式",
	full: "切换居中模式",
};

export function WidthToggle() {
	const { mode, toggleMode } = useWidthMode();
	const Icon = ICONS[mode];

	return (
		<Button variant="ghost" size="icon-sm" onClick={toggleMode} aria-label={LABELS[mode]}>
			<Icon className="h-4 w-4" />
		</Button>
	);
}
