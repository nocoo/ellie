"use client";

// Cloudflare Turnstile widget wrapper for React.
//
// Loads the Turnstile script (https://challenges.cloudflare.com/turnstile/v0/api.js)
// once per page (idempotent — multiple <TurnstileWidget> instances share the
// single <script>) and renders the explicit-render `<div>` Turnstile expects.
// Fires `onSolve(token)` when the user solves the challenge, `onError(reason)`
// when Turnstile reports an error, and `onExpire()` when an already-solved
// token expires.
//
// Caller responsibilities (from docs/17-email-verification.md, rev4 §7.2.1):
// - Pass a non-empty `siteKey`. If the env var is missing, the parent should
//   surface a config error and NOT render this widget. The widget itself
//   refuses to render with an empty key (defence-in-depth).
// - Treat `onSolve` as the authoritative captcha completion signal — only
//   then is the request-code call allowed.
//
// Reviewer notes (msg 32d85f09):
// - Script injection is idempotent: we look up `script[src=...]` before
//   inserting a new tag.
// - The component MUST NOT call stale callbacks after unmount: callback
//   refs + a mounted flag guard every event delivery.

import { useEffect, useRef } from "react";

const TURNSTILE_SCRIPT_SRC =
	"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_SCRIPT_ID = "cf-turnstile-script";

// ─── Global type augmentations for the injected `window.turnstile` API ──────
interface TurnstileRenderOptions {
	sitekey: string;
	callback?: (token: string) => void;
	"error-callback"?: (errorCode?: string) => void;
	"expired-callback"?: () => void;
	"timeout-callback"?: () => void;
	theme?: "light" | "dark" | "auto";
	size?: "normal" | "compact" | "invisible";
}

interface TurnstileApi {
	render(container: string | HTMLElement, options: TurnstileRenderOptions): string;
	reset(widgetId?: string): void;
	remove(widgetId?: string): void;
}

declare global {
	interface Window {
		turnstile?: TurnstileApi;
	}
}

// ─── Script loader (idempotent, returns a Promise resolving when ready) ─────

let scriptLoadPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
	if (typeof window === "undefined") {
		// SSR call — never resolve. Caller must guard.
		return new Promise(() => {});
	}
	if (window.turnstile) {
		return Promise.resolve();
	}
	if (scriptLoadPromise) {
		return scriptLoadPromise;
	}

	scriptLoadPromise = new Promise<void>((resolve, reject) => {
		// Reuse an existing tag if a previous component already injected it.
		const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
		if (existing) {
			if (window.turnstile) {
				resolve();
				return;
			}
			existing.addEventListener("load", () => resolve());
			existing.addEventListener("error", () => reject(new Error("turnstile-script-failed")));
			return;
		}

		const script = document.createElement("script");
		script.id = TURNSTILE_SCRIPT_ID;
		script.src = TURNSTILE_SCRIPT_SRC;
		script.async = true;
		script.defer = true;
		script.addEventListener("load", () => resolve());
		script.addEventListener("error", () => reject(new Error("turnstile-script-failed")));
		document.head.appendChild(script);
	});

	return scriptLoadPromise;
}

// ─── React component ────────────────────────────────────────────────────────

export interface TurnstileWidgetProps {
	/** Cloudflare Turnstile site key (NEXT_PUBLIC_TURNSTILE_SITE_KEY). */
	siteKey: string;
	/** Fired exactly once per successful solve with the captcha token. */
	onSolve: (token: string) => void;
	/** Fired when Turnstile signals an error. The reason string may be empty. */
	onError?: (reason: string) => void;
	/** Fired when an already-solved token expires (user must re-solve). */
	onExpire?: () => void;
	/** Optional className applied to the host container. */
	className?: string;
	/** Optional theme — defaults to "auto" so the widget follows the user's OS setting. */
	theme?: "light" | "dark" | "auto";
}

export function TurnstileWidget({
	siteKey,
	onSolve,
	onError,
	onExpire,
	className,
	theme = "auto",
}: TurnstileWidgetProps) {
	// Stable refs so we never call a stale callback after unmount or a parent
	// re-render that swapped the prop.
	const onSolveRef = useRef(onSolve);
	const onErrorRef = useRef(onError);
	const onExpireRef = useRef(onExpire);
	useEffect(() => {
		onSolveRef.current = onSolve;
	}, [onSolve]);
	useEffect(() => {
		onErrorRef.current = onError;
	}, [onError]);
	useEffect(() => {
		onExpireRef.current = onExpire;
	}, [onExpire]);

	const containerRef = useRef<HTMLDivElement>(null);
	const widgetIdRef = useRef<string | null>(null);

	useEffect(() => {
		// Defence-in-depth: if siteKey was somehow blanked out at runtime, do
		// not contact Cloudflare. The viewmodel's fail-closed gate (`validate
		// TurnstileConfig`) is the primary fence; this is just belt-and-braces.
		if (siteKey.trim() === "") return;

		let cancelled = false;
		const container = containerRef.current;
		if (!container) return;

		loadTurnstileScript()
			.then(() => {
				if (cancelled) return;
				const api = window.turnstile;
				if (!api) {
					onErrorRef.current?.("turnstile-api-missing");
					return;
				}
				try {
					widgetIdRef.current = api.render(container, {
						sitekey: siteKey,
						theme,
						callback: (token: string) => {
							if (cancelled) return;
							onSolveRef.current(token);
						},
						"error-callback": (errorCode?: string) => {
							if (cancelled) return;
							onErrorRef.current?.(errorCode ?? "");
						},
						"expired-callback": () => {
							if (cancelled) return;
							onExpireRef.current?.();
						},
					});
				} catch (err) {
					if (cancelled) return;
					onErrorRef.current?.(err instanceof Error ? err.message : "turnstile-render-failed");
				}
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				onErrorRef.current?.(err instanceof Error ? err.message : "turnstile-load-failed");
			});

		return () => {
			cancelled = true;
			const id = widgetIdRef.current;
			widgetIdRef.current = null;
			if (id != null && typeof window !== "undefined" && window.turnstile) {
				try {
					window.turnstile.remove(id);
				} catch {
					// Defensive — Turnstile occasionally throws on remove during fast
					// reload; swallowing keeps unmount clean.
				}
			}
		};
	}, [siteKey, theme]);

	return <div ref={containerRef} className={className} />;
}

// Test-only export: reset the cached script-load promise so tests starting
// from a fresh JSDOM can re-trigger the loader. Not consumed by production
// code — guarded by a __test prefix.
export function __resetTurnstileLoaderForTests(): void {
	scriptLoadPromise = null;
}
