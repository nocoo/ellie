// Route: /forums/[id]/new-thread — Discuz-style 发表主题 page
// Server Component shell that loads breadcrumb data, then renders the client form.

import type { Metadata } from "next";
import Link from "next/link";
import { NewThreadForm } from "@/components/forum/new-thread-form";
import { Card, CardContent } from "@/components/ui/card";
import { loadNewThreadPageData } from "@/viewmodels/forum/new-thread.server";
import { fetchPublicSettings, getStr } from "@/viewmodels/forum/settings.server";
import { parseIntParam } from "@/viewmodels/shared/params";

interface NewThreadPageProps {
	params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: NewThreadPageProps): Promise<Metadata> {
	const { id } = await params;
	const forumId = parseIntParam(id);
	if (forumId == null) return { title: "发表主题" };
	try {
		const data = await loadNewThreadPageData(forumId);
		return { title: `发表主题 - ${data.forumName}` };
	} catch {
		return { title: "发表主题" };
	}
}

export default async function NewThreadPage({ params }: NewThreadPageProps) {
	const { id } = await params;
	const forumId = parseIntParam(id);

	if (forumId == null) {
		return (
			<Card size="sm">
				<CardContent className="text-center py-4">
					<p className="text-sm text-destructive">无效的版块 ID</p>
					<Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
						返回首页
					</Link>
				</CardContent>
			</Card>
		);
	}

	const settings = await fetchPublicSettings();
	const homeLabel = getStr(settings, "general.site.home_label", "同济网论坛");
	let breadcrumbs = [{ label: homeLabel, href: "/" }, { label: "发表主题" }];

	try {
		const data = await loadNewThreadPageData(forumId);
		breadcrumbs = data.breadcrumbs;
	} catch {
		// Fallback breadcrumbs if API fails — page still renders
	}

	return <NewThreadForm breadcrumbs={breadcrumbs} forumId={forumId} />;
}
