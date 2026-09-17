"use client";

import { createLucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const Hexly = createLucideIcon("Hexly", [
	["path", { d: "m12 2 8.66 5v10L12 22l-8.66-5V7Z", key: "hexagon" }],
	["path", { d: "M12 2v20M3.34 7l17.32 10m0-10L3.34 17", key: "segments" }],
]);

export function HeaderTooltip({ label, children }: { label: string; children: ReactElement }) {
	return (
		<Tooltip>
			<TooltipTrigger render={children} delay={200} className="cursor-pointer" />
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}

export function HexlyLink() {
	return (
		<HeaderTooltip label="在 hexly.ai 查看 Ellie">
			<Button
				variant="ghost"
				size="icon"
				nativeButton={false}
				role="link"
				aria-label="在 hexly.ai 查看 Ellie（新标签页）"
				render={
					<a href="https://hexly.ai/projects/ellie" target="_blank" rel="noopener noreferrer" />
				}
			>
				<Hexly className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
			</Button>
		</HeaderTooltip>
	);
}
