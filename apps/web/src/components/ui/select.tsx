"use client";

import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import type * as React from "react";

interface SelectOption {
	value: string | number;
	label: string;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> {
	options: SelectOption[];
}

function Select({ className, options, ...props }: SelectProps) {
	return (
		<div className="relative">
			<select
				data-slot="select"
				className={cn(
					"h-8 w-full appearance-none rounded-lg border border-input bg-transparent px-2.5 pr-8 text-sm transition-colors outline-none",
					"placeholder:text-muted-foreground",
					"focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
					"disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50",
					"dark:bg-input/30 dark:disabled:bg-input/80",
					className,
				)}
				{...props}
			>
				{options.map((opt) => (
					<option key={opt.value} value={opt.value}>
						{opt.label}
					</option>
				))}
			</select>
			<ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
		</div>
	);
}

export { Select, type SelectOption };
