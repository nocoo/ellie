// components/forum/safe-html.tsx — Render sanitized inline HTML
// Wraps lib/safe-html.ts sanitizer in a <span> with dangerouslySetInnerHTML.
// Works in both RSC and client components.

import { sanitizeInlineHtml } from "@/lib/safe-html";

interface SafeHtmlProps {
	html: string | undefined | null;
	className?: string;
	as?: "span" | "p" | "div";
}

export function SafeHtml({ html, className, as: Tag = "span" }: SafeHtmlProps) {
	if (!html) return null;
	const safeHtml = sanitizeInlineHtml(html);
	// biome-ignore lint/security/noDangerouslySetInnerHtml: input is sanitized via whitelist
	return <Tag className={className} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
