import { auth } from "@/auth";
import { AppShell } from "@/components/layout/app-shell";
import { resolveAdmin } from "@/lib/admin";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export default async function AdminLayout({ children }: { children: ReactNode }) {
	const session = await auth();
	const admin = resolveAdmin(session);

	if (!admin) {
		redirect("/login");
	}

	return <AppShell>{children}</AppShell>;
}
