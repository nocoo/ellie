// (forum)/layout.tsx — Forum Route Group layout
// Ref: 04d §路由结构 — ForumLayout wraps all forum pages

import { ForumLayout } from "@/components/layout/forum-layout";
import type { ReactNode } from "react";

/**
 * Forum layout wraps all public forum pages (/, /forums/*, /threads/*, etc.).
 *
 * Phase 2: This layout will call auth() to pass user to TopBar.
 * Mock phase: No auth — user prop is omitted (guest view).
 */
export default function ForumGroupLayout({ children }: { children: ReactNode }) {
	// Phase 2: const session = await auth(); pass session.user to ForumLayout
	return <ForumLayout>{children}</ForumLayout>;
}
