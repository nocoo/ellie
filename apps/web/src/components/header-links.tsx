"use client";

import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function HeaderTooltip({ label, children }: { label: string; children: ReactElement }) {
	return (
		<Tooltip>
			<TooltipTrigger render={children} delay={200} className="cursor-pointer" />
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}
