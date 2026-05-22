// components/forum/safe-rich-html.tsx — Render sanitized rich HTML
// Used by `AnnouncementCard` and `AnnouncementEditDialog` preview.
// Allowlist matches the Worker-side sanitizer (img/font allowed,
// unlike `SafeHtml` which is for inline-only surfaces).

import { sanitizeRichHtml } from "@/lib/safe-rich-html";

interface SafeRichHtmlProps {
	html: string | undefined | null;
	className?: string;
	as?: "div" | "section" | "article";
}

export function SafeRichHtml({ html, className, as: Tag = "div" }: SafeRichHtmlProps) {
	if (!html) return null;
	const safeHtml = sanitizeRichHtml(html);
	if (safeHtml === "") return null;
	// biome-ignore lint/security/noDangerouslySetInnerHtml: input is sanitized via whitelist
	return <Tag className={className} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
