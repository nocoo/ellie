import { adminAuth } from "@/auth-admin";
import { AppShell } from "@/components/layout/app-shell";
import { resolveAdmin } from "@/lib/admin";
import { fetchPublicSettings, getStr } from "@/viewmodels/forum/settings.server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export async function generateMetadata(): Promise<Metadata> {
	const settings = await fetchPublicSettings();
	const siteName = getStr(settings, "general.site.name", "Ellie");
	return { title: `管理控制台 | ${siteName}` };
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
	const session = await adminAuth();
	const admin = resolveAdmin(session);

	if (!admin) {
		redirect("/admin/login");
	}

	return <AppShell>{children}</AppShell>;
}
