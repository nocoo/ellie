import { ForumLayoutShell } from "@/components/forum/forum-layout";
import type { ReactNode } from "react";

export default function ForumLayout({ children }: { children: ReactNode }) {
	return <ForumLayoutShell>{children}</ForumLayoutShell>;
}
