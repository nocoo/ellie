// Proxy supplies the trusted page/filter context for both forum routes.

import { notFound, permanentRedirect } from "next/navigation";
import ForumThreadsPage from "../page";

export { generateMetadata } from "../page";

interface PagedProps {
	params: Promise<{ id: string; page: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PAGE_PARAM_RE = /^[1-9]\d*$/;

export default async function ForumThreadsPagedPage({ params, searchParams }: PagedProps) {
	const { id, page } = await params;

	const n = Number(page);
	if (!PAGE_PARAM_RE.test(page) || !Number.isSafeInteger(n)) notFound();
	if (n === 1) {
		const qs = buildPassthroughQuery(await searchParams);
		permanentRedirect(`/forums/${id}${qs}`);
	}

	return ForumThreadsPage({ params: Promise.resolve({ id }) });
}

function buildPassthroughQuery(sp: Record<string, string | string[] | undefined>): string {
	// Only allow `typeId` through on the page=1 redirect. Anything else is
	// not part of the forum-list canonical surface.
	const typeId = sp.typeId;
	if (typeof typeId !== "string" || typeId === "") return "";
	const params = new URLSearchParams();
	params.set("typeId", typeId);
	return `?${params.toString()}`;
}
