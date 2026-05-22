// Path-segment canonical pagination alias for `/forums/:id/:page`.
//
// This route reuses the same loader / view as `/forums/:id` — we only
// translate the path `:page` segment into `searchParams.page` and then
// delegate to the bare-id default export. Keeping the data path single
// avoids drift between query- and path-canonical renderings.
//
// Behavior:
//   • `:page` MUST be a positive integer (`^[1-9]\d*$`). Anything else
//     (`abc`, `0`, `-1`, leading zeros) → `notFound()`.
//   • `:page === 1` is NOT canonical. The proxy already 301s
//     `/forums/:id/1` → `/forums/:id` before this route renders, so
//     defense-in-depth: if we ever receive page=1 here we still 301
//     instead of double-rendering the first page.
//   • `:page >= 2` directly renders the canonical view.

import { notFound, permanentRedirect } from "next/navigation";
import ForumThreadsPage from "../page";

interface PagedProps {
	params: Promise<{ id: string; page: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PAGE_PARAM_RE = /^[1-9]\d*$/;

export default async function ForumThreadsPagedPage({ params, searchParams }: PagedProps) {
	const { id, page } = await params;
	const sp = await searchParams;

	if (!PAGE_PARAM_RE.test(page)) notFound();
	const n = Number.parseInt(page, 10);
	if (n === 1) {
		const qs = buildPassthroughQuery(sp);
		permanentRedirect(`/forums/${id}${qs}`);
	}

	// Reuse the canonical view. `sp.page` is overridden so the existing
	// page reads the segment-supplied value; any other search params
	// (e.g. `typeId`) flow through unchanged.
	return ForumThreadsPage({
		params: Promise.resolve({ id }),
		searchParams: Promise.resolve({ ...pickForumSp(sp), page: String(n) }),
	});
}

function pickForumSp(sp: Record<string, string | string[] | undefined>): {
	page?: string;
	typeId?: string;
} {
	const out: { page?: string; typeId?: string } = {};
	const typeId = sp.typeId;
	if (typeof typeId === "string") out.typeId = typeId;
	return out;
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
