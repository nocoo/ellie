"use client";

// Cap.js CAPTCHA widget wrapper for React
// https://github.com/tiagozip/cap

import React, { useEffect, useRef, useState } from "react";

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

		return () => {
			widget.removeEventListener("solve", handleSolve);
			widget.removeEventListener("error", handleError);
		};
	}, [mounted]);

	if (!mounted) {
		// SSR placeholder
		return <div className={className} style={{ height: 50 }} />;
	}

	// Use React.createElement for custom element to bypass JSX type checking
	return React.createElement("cap-widget", {
		ref: widgetRef,
		"data-cap-api-endpoint": apiEndpoint,
		"data-cap-i18n-initial-state": "点击验证",
		"data-cap-i18n-verifying-label": "验证中...",
		"data-cap-i18n-solved-label": "验证成功",
		"data-cap-i18n-error-label": "验证失败",
		className,
	});
}
