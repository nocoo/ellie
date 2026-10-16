"use client";

// Cap.js CAPTCHA widget wrapper for React
// https://github.com/tiagozip/cap

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const CAP_SHADOW_SKIN = `
.credits {
	left: -9999px !important;
	width: 0 !important;
	height: 0 !important;
	overflow: hidden !important;
	margin: 0 !important;
	padding: 0 !important;
}
.captcha {
	box-sizing: border-box;
	overflow: hidden;
}
.captcha:hover {
	filter: none;
}
.captcha p {
	font-size: 0.875rem;
	font-weight: 500;
}
`;

interface CapWidgetProps {
	/** Cap API endpoint URL (e.g., https://cap.example.com/site-key/) */
	apiEndpoint: string;
	/** Callback when captcha is solved */
	onSolve?: (token: string) => void;
	/** Callback on error */
	onError?: (message: string) => void;
	/** Additional class names */
	className?: string;
}

export function CapWidget({ apiEndpoint, onSolve, onError, className }: CapWidgetProps) {
	const widgetRef = useRef<HTMLElement>(null);
	const [mounted, setMounted] = useState(false);

	// Stable refs so event handlers always call the latest callback without
	// needing the callback identity in the effect dependency array.
	const onSolveRef = useRef(onSolve);
	const onErrorRef = useRef(onError);
	useEffect(() => {
		onSolveRef.current = onSolve;
	}, [onSolve]);
	useEffect(() => {
		onErrorRef.current = onError;
	}, [onError]);

	// Only render on client — also defer cap widget import until browser,
	// since @cap.js/widget touches `navigator` at module load (SSR crash).
	useEffect(() => {
		import("@cap.js/widget").then(() => setMounted(true));
	}, []);

	// Attach event listeners once the real <cap-widget> element is in the DOM.
	// `mounted` gates this: when false the DOM holds a placeholder <div> and
	// there is nothing useful to listen on.
	useEffect(() => {
		if (!mounted) return;
		const widget = widgetRef.current;
		if (!widget) return;

		const handleSolve = (e: Event) => {
			const detail = (e as CustomEvent<{ token: string }>).detail;
			onSolveRef.current?.(detail.token);
		};

		const handleError = (e: Event) => {
			const detail = (e as CustomEvent<{ message: string }>).detail;
			onErrorRef.current?.(detail.message);
		};

		widget.addEventListener("solve", handleSolve);
		widget.addEventListener("error", handleError);

		const applySkin = () => {
			const root = widget.shadowRoot;
			if (!root || root.querySelector("[data-ellie-cap-skin]")) return;
			const style = document.createElement("style");
			style.setAttribute("data-ellie-cap-skin", "");
			style.textContent = CAP_SHADOW_SKIN;
			root.appendChild(style);
		};
		applySkin();
		const frame = requestAnimationFrame(applySkin);

		return () => {
			cancelAnimationFrame(frame);
			widget.removeEventListener("solve", handleSolve);
			widget.removeEventListener("error", handleError);
		};
	}, [mounted]);

	if (!mounted) {
		return <div className={cn("h-11 w-full", className)} />;
	}

	return React.createElement("cap-widget", {
		ref: widgetRef,
		"data-cap-api-endpoint": apiEndpoint,
		"data-cap-i18n-initial-state": "点击验证",
		"data-cap-i18n-verifying-label": "验证中...",
		"data-cap-i18n-solved-label": "验证成功",
		"data-cap-i18n-error-label": "验证失败",
		className: cn("w-full", className),
	});
}
