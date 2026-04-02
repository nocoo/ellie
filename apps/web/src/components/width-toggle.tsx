// components/width-toggle.tsx — Toggle between fixed and full-width layout
// Uses data-width-mode attribute on <html> element

"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui/button";

type WidthMode = "fixed" | "full";

const STORAGE_KEY = "ellie-width-mode";

export function WidthToggle() {
	const [mode, setMode] = useState<WidthMode>("fixed");

	// Initialize from localStorage and apply to DOM
	useEffect(() => {
		const stored = localStorage.getItem(STORAGE_KEY) as WidthMode | null;
		const initial = stored === "full" ? "full" : "fixed";
		setMode(initial);
		document.documentElement.dataset.widthMode = initial;
	}, []);

	const toggleMode = useCallback(() => {
		const next = mode === "fixed" ? "full" : "fixed";
		setMode(next);
		localStorage.setItem(STORAGE_KEY, next);
		document.documentElement.dataset.widthMode = next;
	}, [mode]);

	const Icon = mode === "fixed" ? Maximize2 : Minimize2;
	const label = mode === "fixed" ? "切换全屏宽度" : "切换固定宽度";

	return (
		<Button variant="ghost" size="icon" onClick={toggleMode} aria-label={label} title={label}>
			<Icon className="h-4 w-4" />
		</Button>
	);
}
