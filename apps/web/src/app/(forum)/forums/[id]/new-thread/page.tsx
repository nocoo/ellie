// Route: /forums/[id]/new-thread — Discuz-style 发表帖子 page
// Server Component shell that loads breadcrumb data, then renders the client form.

import { NewThreadForm } from "@/components/forum/new-thread-form";
import { loadNewThreadPageData } from "@/viewmodels/forum/new-thread.server";
import { parseIntParam } from "@/viewmodels/shared/params";

interface NewThreadPageProps {
	params: Promise<{ id: string }>;
}

export default async function NewThreadPage({ params }: NewThreadPageProps) {
	const { id } = await params;
	const forumId = parseIntParam(id);

	let breadcrumbs = [{ label: "首页", href: "/" }, { label: "发表帖子" }];

	try {
		const data = await loadNewThreadPageData(forumId);
		breadcrumbs = data.breadcrumbs;
	} catch {
		// Fallback breadcrumbs if API fails — page still renders
	}

	return <NewThreadForm breadcrumbs={breadcrumbs} forumId={forumId} />;
}
