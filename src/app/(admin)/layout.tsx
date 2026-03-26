// (admin)/layout.tsx — Admin Route Group layout with AdminLayout shell
// Ref: 04c §AdminLayout — sidebar + header + content area
//
// Wraps all /admin/* pages in the AdminLayout component which provides
// the sidebar navigation, header, and responsive behavior.
// Session user info is passed to the sidebar for display.

import { AdminLayout } from "@/components/layout/admin-layout";
import { auth } from "@/lib/auth-instance";
import type { ReactNode } from "react";

export default async function AdminGroupLayout({ children }: { children: ReactNode }) {
	// Read session to display user info in sidebar
	let user: { username: string; avatar?: string | null } | undefined;
	try {
		const session = await auth();
		if (session?.user) {
			user = {
				username: session.user.name ?? "Admin",
				avatar: session.user.image,
			};
		}
	} catch {
		// Not in Next.js request context — skip user info
	}

	return <AdminLayout user={user}>{children}</AdminLayout>;
}
