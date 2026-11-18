"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@nocoo/basalt/components/tooltip";
import type { ReactElement } from "react";

export function HeaderTooltip({ label, children }: { label: string; children: ReactElement }) {
	return (
		<Tooltip delayDuration={200}>
			<TooltipTrigger asChild className="cursor-pointer">
				{children}
			</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}
