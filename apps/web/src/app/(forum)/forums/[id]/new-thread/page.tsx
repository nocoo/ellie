import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { NewThreadForm } from "@/components/forum/new-thread-form";
import { ForumApiError } from "@/lib/forum-api";
import { getCachedForumThreadTypes } from "@/lib/forum-cache";
import { getSelfForumUser } from "@/lib/forum-self";
import {
	loadNewThreadPageData,
	type NewThreadPageData,
} from "@/viewmodels/forum/new-thread.server";
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
	if (forumId == null) notFound();

	const self = await getSelfForumUser();
	if (!self) redirect(`/login?redirect=${encodeURIComponent(`/forums/${forumId}/new-thread`)}`);

	let data: NewThreadPageData;
	try {
		data = await loadNewThreadPageData(forumId);
	} catch (error) {
		if (error instanceof ForumApiError && error.status === 404) notFound();
		throw error;
	}
	if (data.isGroup) redirect(`/forums/${forumId}`);
	const threadTypes = await getCachedForumThreadTypes(forumId);

	return (
		<NewThreadForm
			breadcrumbs={data.breadcrumbs}
			forumId={forumId}
			forumName={data.forumName}
			threadTypes={threadTypes}
			selfEmailVerifiedAt={self.emailVerifiedAt}
		/>
	);
}
