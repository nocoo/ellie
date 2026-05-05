"use client";

// components/forum/forum-toast.tsx — Lightweight global toast system
// No external dependencies. Provides ForumToastProvider + useForumToast().

import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle, Info, X } from "lucide-react";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastType = "success" | "error" | "info";

interface ToastItem {
	id: number;
	type: ToastType;
	title: string;
	description?: string;
}

interface ToastOptions {
	title: string;
	description?: string;
}

interface ForumToastContextValue {
	success: (titleOrOpts: string | ToastOptions) => void;
	error: (titleOrOpts: string | ToastOptions) => void;
	info: (titleOrOpts: string | ToastOptions) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ForumToastContext = createContext<ForumToastContextValue | null>(null);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTO_DISMISS_MS = 4000;
const MAX_VISIBLE = 5;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ForumToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<ToastItem[]>([]);
	const nextId = useRef(0);

	const addToast = useCallback((type: ToastType, titleOrOpts: string | ToastOptions) => {
		const opts = typeof titleOrOpts === "string" ? { title: titleOrOpts } : titleOrOpts;
		const id = nextId.current++;
		setToasts((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { id, type, ...opts }]);
		return id;
	}, []);

	const removeToast = useCallback((id: number) => {
		setToasts((prev) => prev.filter((t) => t.id !== id));
	}, []);

	const ctx: ForumToastContextValue = useMemo(
		() => ({
			success: (o: string | ToastOptions) => addToast("success", o),
			error: (o: string | ToastOptions) => addToast("error", o),
			info: (o: string | ToastOptions) => addToast("info", o),
		}),
		[addToast],
	);

	return (
		<ForumToastContext.Provider value={ctx}>
			{children}
			<ToastContainer toasts={toasts} onRemove={removeToast} />
		</ForumToastContext.Provider>
	);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useForumToast(): ForumToastContextValue {
	const ctx = useContext(ForumToastContext);
	if (!ctx) {
		throw new Error("useForumToast must be used within ForumToastProvider");
	}
	return ctx;
}

// ---------------------------------------------------------------------------
// Toast Container (fixed overlay)
// ---------------------------------------------------------------------------

function ToastContainer({
	toasts,
	onRemove,
}: { toasts: ToastItem[]; onRemove: (id: number) => void }) {
	if (toasts.length === 0) return null;

	return (
		<div
			aria-live="polite"
			aria-atomic="false"
			className="fixed top-4 inset-x-4 z-[9999] flex flex-col gap-2 pointer-events-none w-auto sm:inset-x-auto sm:right-4 sm:w-full sm:max-w-sm"
		>
			{toasts.map((toast) => (
				<ToastCard key={toast.id} toast={toast} onClose={() => onRemove(toast.id)} />
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Single Toast Card
// ---------------------------------------------------------------------------

const iconMap: Record<ToastType, typeof CheckCircle> = {
	success: CheckCircle,
	error: AlertCircle,
	info: Info,
};

const styleMap: Record<ToastType, string> = {
	success:
		"border-green-500/30 bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-200",
	error: "border-destructive/30 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200",
	info: "border-blue-500/30 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200",
};

function ToastCard({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
	const Icon = iconMap[toast.type];

	// Auto-dismiss
	useEffect(() => {
		const timer = setTimeout(onClose, AUTO_DISMISS_MS);
		return () => clearTimeout(timer);
	}, [onClose]);

	return (
		<div
			role="alert"
			className={cn(
				"pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2.5 shadow-md animate-in fade-in slide-in-from-top-2 duration-200",
				styleMap[toast.type],
			)}
		>
			<Icon className="h-4 w-4 shrink-0 mt-0.5" />
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium">{toast.title}</p>
				{toast.description && <p className="mt-0.5 text-xs opacity-80">{toast.description}</p>}
			</div>
			<button
				type="button"
				onClick={onClose}
				className="shrink-0 rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
				aria-label="关闭"
			>
				<X className="h-3.5 w-3.5" />
			</button>
		</div>
	);
}
