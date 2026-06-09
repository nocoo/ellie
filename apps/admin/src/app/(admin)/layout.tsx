import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { AppShell } from "@/components/layout/app-shell";
import { resolveAdmin } from "@/lib/admin";

export const metadata: Metadata = {
	title: "管理控制台 | Ellie Admin",
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
	const session = await auth();
	const admin = resolveAdmin(session);

	if (!admin) {
		redirect("/login");
	}

	return <AppShell>{children}</AppShell>;
}
