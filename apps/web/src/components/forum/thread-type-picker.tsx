"use client";

// components/forum/thread-type-picker.tsx — 主题分类 picker for new-thread compose
// Pill-style single-select. Rendered only when the host forum has thread-types
// enabled AND at least one row (callers gate via `shouldShowPicker`). When the
// forum marks 分类 required, the caller surfaces an inline error string — the
// picker itself stays presentational so it can be reused by other compose
// surfaces (quick reply / mobile sheet) later.

import type { ForumThreadType } from "@ellie/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ThreadTypePickerProps {
	types: ForumThreadType[];
	/** Currently selected typeId. `null` = nothing selected. */
	value: number | null;
	/** Pass `null` to clear (only available when `required` is false). */
	onChange: (typeId: number | null) => void;
	/** If true, hide the "不选" pill — caller must pick a category. */
	required?: boolean;
	/** Inline error string from the submit pre-flight. */
	error?: string | null;
	/** Disable all pills (e.g. while a submit is in-flight). */
	disabled?: boolean;
}

export function ThreadTypePicker({
	types,
	value,
	onChange,
	required = false,
	error,
	disabled = false,
}: ThreadTypePickerProps) {
	if (types.length === 0) return null;

	return (
		<div className="px-5 pt-3" data-testid="thread-type-picker" aria-label="主题分类">
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-xs text-muted-foreground">
					分类
					{required && <span className="ml-0.5 text-destructive">*</span>}：
				</span>
				{!required && (
					<TypePill
						label="不选"
						active={value == null}
						disabled={disabled}
						onClick={() => onChange(null)}
					/>
				)}
				{types.map((t) => (
					<TypePill
						key={t.id}
						label={t.name}
						active={value === t.id}
						disabled={disabled}
						onClick={() => onChange(t.id)}
					/>
				))}
			</div>
			{error && (
				<p className="mt-1.5 text-xs text-destructive" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}

interface TypePillProps {
	label: string;
	active: boolean;
	disabled: boolean;
	onClick: () => void;
}

function TypePill({ label, active, disabled, onClick }: TypePillProps) {
	return (
		<Button
			type="button"
			variant={active ? "default" : "outline"}
			size="xs"
			aria-pressed={active}
			aria-checked={active}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"h-7 px-3 text-xs",
				active && "bg-primary text-primary-foreground hover:bg-primary/90",
			)}
		>
			{label}
		</Button>
	);
}
