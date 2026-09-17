"use client";

import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@nocoo/basalt";
import { useTheme } from "@nocoo/basalt/providers/theme";
import { createLucideIcon, Monitor, Moon, Sun } from "lucide-react";
import type { ReactElement } from "react";

const Hexly = createLucideIcon("Hexly", [
	["path", { d: "m12 2 8.66 5v10L12 22l-8.66-5V7Z", key: "hexagon" }],
	["path", { d: "M12 2v20M3.34 7l17.32 10m0-10L3.34 17", key: "segments" }],
]);

function HeaderTooltip({ label, children }: { label: string; children: ReactElement }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}

export function HeaderActions() {
	const { theme, setTheme } = useTheme();
	const nextTheme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
	const label =
		nextTheme === "system"
			? "跟随系统主题"
			: nextTheme === "light"
				? "切换浅色主题"
				: "切换深色主题";
	const ThemeIcon = theme === "system" ? Monitor : theme === "dark" ? Moon : Sun;

	return (
		<>
			<HeaderTooltip label="在 hexly.ai 查看 Ellie">
				<Button variant="ghost" size="icon" asChild>
					<a
						href="https://hexly.ai/projects/ellie"
						target="_blank"
						rel="noopener noreferrer"
						aria-label="在 hexly.ai 查看 Ellie（新标签页）"
					>
						<Hexly className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
					</a>
				</Button>
			</HeaderTooltip>
			<HeaderTooltip label={label}>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					onClick={() => setTheme(nextTheme)}
					aria-label="切换主题"
				>
					<ThemeIcon className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
				</Button>
			</HeaderTooltip>
		</>
	);
}
