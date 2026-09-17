// components/theme-toggle.tsx — Three-state theme toggle button
// Ref: 04b §ThemeToggle — cycles light → dark → system

"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { type Theme, useTheme } from "@/hooks/use-theme";
import { HeaderTooltip } from "./header-links";
import { Button } from "./ui/button";

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
	const label =
		theme === "system" ? "切换浅色主题" : theme === "light" ? "切换深色主题" : "跟随系统主题";

	return (
		<HeaderTooltip label={label}>
			<Button variant="ghost" size="icon" onClick={cycleTheme} aria-label={LABELS[theme]}>
				<Icon className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
			</Button>
		</HeaderTooltip>
	);
}
