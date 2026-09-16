"use client";

import { Button, DialogClose, DialogContent } from "@nocoo/basalt";
import { X } from "lucide-react";
import { type ComponentProps, useRef } from "react";
import { twMerge } from "tailwind-merge";

type AdminDialogContentProps = ComponentProps<typeof DialogContent> & {
	closeControl?: boolean;
	closeDisabled?: boolean;
};

export function AdminDialogContent({
	children,
	className,
	closeControl = true,
	closeDisabled = false,
	onOpenAutoFocus,
	onCloseAutoFocus,
	...props
}: AdminDialogContentProps) {
	const returnFocus = useRef<HTMLElement | null>(null);
	return (
		<DialogContent
			{...props}
			className={twMerge("grid gap-4", className)}
			onOpenAutoFocus={(event) => {
				const active =
					document.activeElement instanceof HTMLElement ? document.activeElement : null;
				const menuTrigger = active?.closest('[role="menu"]')?.getAttribute("aria-labelledby");
				returnFocus.current = menuTrigger ? document.getElementById(menuTrigger) : active;
				onOpenAutoFocus?.(event);
			}}
			onCloseAutoFocus={(event) => {
				onCloseAutoFocus?.(event);
				if (!event.defaultPrevented && returnFocus.current?.isConnected) {
					event.preventDefault();
					returnFocus.current.focus();
				}
			}}
		>
			{closeControl && (
				<DialogClose asChild>
					<Button
						variant="ghost"
						size="icon"
						className="absolute right-3 top-3 h-8 w-8"
						aria-label="关闭弹窗"
						disabled={closeDisabled}
					>
						<X className="h-4 w-4" />
					</Button>
				</DialogClose>
			)}
			{children}
		</DialogContent>
	);
}
