import { CodeBlock, CodeHighlighted } from "@nocoo/basalt/components/code";
import type React from "react";
import { twMerge as cn } from "tailwind-merge";

export interface JsonCodeBlockProps {
	/** Anything JSON-serialisable; strings are rendered as plain text. */
	value: unknown;
	className?: string;
}

export function JsonCodeBlock({ value, className }: JsonCodeBlockProps): React.JSX.Element {
	const isString = typeof value === "string";

	const baseClass = cn(
		"mt-1 max-w-full overflow-x-auto whitespace-pre p-3 text-xs leading-5",
		className,
	);

	if (isString) {
		return (
			<CodeBlock copyable={false} className={cn(baseClass, "whitespace-pre-wrap break-all")}>
				{value}
			</CodeBlock>
		);
	}

	const pretty = JSON.stringify(value, null, 2) ?? "";
	return <CodeHighlighted copyable={false} className={baseClass} code={pretty} />;
}
