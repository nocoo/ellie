"use client";

import { Toast } from "@base-ui/react/toast";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "info";
interface ToastOptions {
	title: string;
	description?: string;
}
interface ForumToastContextValue {
	success: (options: string | ToastOptions) => void;
	error: (options: string | ToastOptions) => void;
	info: (options: string | ToastOptions) => void;
}
const ForumToastContext = createContext<ForumToastContextValue | null>(null);

export function ForumToastProvider({ children }: { children: ReactNode }) {
	return (
		<Toast.Provider timeout={5000} limit={4}>
			<ForumToastContent>{children}</ForumToastContent>
		</Toast.Provider>
	);
}

export function useForumToast(): ForumToastContextValue {
	const value = useContext(ForumToastContext);
	if (!value) throw new Error("useForumToast must be used within ForumToastProvider");
	return value;
}

const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
const colors = {
	success: "bg-success/10 text-success",
	error: "bg-destructive/10 text-destructive",
	info: "bg-primary/10 text-primary",
};

function ForumToastContent({ children }: { children: ReactNode }) {
	const { toasts, add } = Toast.useToastManager();
	const value = useMemo(() => {
		const notify = (type: ToastType, options: string | ToastOptions) => {
			const content = typeof options === "string" ? { title: options } : options;
			add({
				...content,
				type,
				timeout: type === "error" ? 9000 : 5000,
				priority: "low",
			});
		};
		return {
			success: (options: string | ToastOptions) => notify("success", options),
			error: (options: string | ToastOptions) => notify("error", options),
			info: (options: string | ToastOptions) => notify("info", options),
		};
	}, [add]);
	return (
		<ForumToastContext.Provider value={value}>
			{children}
			<Toast.Portal>
				<Toast.Viewport
					aria-label="操作提示"
					className="pointer-events-none fixed inset-x-3 top-3 z-[9999] flex flex-col gap-2 outline-none sm:inset-x-auto sm:right-5 sm:top-5 sm:w-96 sm:max-w-[calc(100vw-2.5rem)]"
				>
					{toasts.map((toast) => {
						const type = (toast.type ?? "info") as ToastType;
						const Icon = icons[type];
						return (
							<Toast.Root
								key={toast.id}
								toast={toast}
								role="alert"
								aria-live={type === "error" ? "assertive" : "polite"}
								aria-hidden={!!toast.limited || toast.transitionStatus === "ending"}
								swipeDirection={["right", "up"]}
								className="forum-toast pointer-events-auto rounded-xl border border-border bg-card text-card-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring data-limited:hidden"
							>
								<Toast.Content className="flex items-start gap-3 p-3.5">
									<span
										className={cn(
											"mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
											colors[type],
										)}
									>
										<Icon className="size-4" aria-hidden="true" />
									</span>
									<div className="min-w-0 flex-1 py-1">
										<Toast.Title className="text-sm font-medium leading-5" />
										{toast.description && (
											<Toast.Description className="mt-1 break-words text-xs leading-5 text-muted-foreground" />
										)}
									</div>
									<Toast.Close
										render={
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label="关闭"
												className="size-7 shrink-0 text-muted-foreground"
											/>
										}
									>
										<X className="size-3.5" aria-hidden="true" />
									</Toast.Close>
								</Toast.Content>
							</Toast.Root>
						);
					})}
				</Toast.Viewport>
			</Toast.Portal>
		</ForumToastContext.Provider>
	);
}
