// components/theme-toggle.tsx — Three-state theme toggle button
// Ref: 04b §ThemeToggle — cycles light → dark → system

"use client";

import { Button } from "@ellie/ui";
import { Monitor, Moon, Sun } from "lucide-react";
import { type Theme, useTheme } from "@/hooks/use-theme";

const ICONS: Record<Theme, typeof Sun> = {
	light: Sun,
	dark: Moon,
	system: Monitor,
};

const LABELS: Record<Theme, string> = {
	light: "Light mode",
	dark: "Dark mode",
	system: "System theme",
};

export function ThemeToggle() {
	const { theme, cycleTheme } = useTheme();
	const Icon = ICONS[theme];

	return (
		<Button variant="ghost" size="icon" onClick={cycleTheme} aria-label={LABELS[theme]}>
			<Icon className="h-4 w-4" />
		</Button>
	);
}
