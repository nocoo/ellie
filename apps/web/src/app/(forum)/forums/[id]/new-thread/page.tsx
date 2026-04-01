// Route: /forums/[id]/new-thread — Discuz-style 发表帖子 page
// Server Component shell that loads breadcrumb data, then renders the client form.

import { NewThreadForm } from "@/components/forum/new-thread-form";
import { Card, CardContent } from "@/components/ui/card";
import { loadNewThreadPageData } from "@/viewmodels/forum/new-thread.server";
import { parseIntParam } from "@/viewmodels/shared/params";
import Link from "next/link";
import type { Metadata } from "next";

interface NewThreadPageProps {
	params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: NewThreadPageProps): Promise<Metadata> {
	const { id } = await params;
	const forumId = parseIntParam(id);
	if (forumId == null) return { title: "发表帖子" };
	try {
		const data = await loadNewThreadPageData(forumId);
		return { title: `发表帖子 - ${data.forumName}` };
	} catch {
		return { title: "发表帖子" };
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

	let breadcrumbs = [{ label: "首页", href: "/" }, { label: "发表帖子" }];

	try {
		const data = await loadNewThreadPageData(forumId);
		breadcrumbs = data.breadcrumbs;
	} catch {
		// Fallback breadcrumbs if API fails — page still renders
	}

	return <NewThreadForm breadcrumbs={breadcrumbs} forumId={forumId} />;
}
