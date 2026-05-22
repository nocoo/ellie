// Path-segment canonical pagination alias for `/threads/:id/:page`.
//
// Reuses `/threads/:id`'s loader / view by translating the path
// segment into `searchParams.page`. The bare-id route resolves cursor /
// last / page priority via `resolveThreadPostCursor`, but for the
// path-canonical alias the `:page` segment is AUTHORITATIVE — we drop
// any `cursor` / `direction` / `last` query so they cannot beat the
// segment-supplied page (priority in the bare-id route is
// cursor > last > page, which would otherwise let
// `/threads/:id/2?cursor=...` silently render the cursor page, not
// page 2).
//
// Behavior:
//   • `:page` MUST be a positive integer (`^[1-9]\d*$`). Anything else
//     (`abc`, `0`, `-1`, leading zeros) → `notFound()`.
//   • `:page === 1` is NOT canonical — 301 to the bare path. Only
//     `returnTo` survives the redirect; cursor / direction / last are
//     internal pagination plumbing that we drop.
//   • `:page >= 2` directly renders the canonical view with ONLY
//     `returnTo` (when present) plus the segment-supplied `page`.

import { notFound, permanentRedirect } from "next/navigation";
import ThreadDetailPage from "../page";

interface PagedProps {
	params: Promise<{ id: string; page: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PAGE_PARAM_RE = /^[1-9]\d*$/;

export default async function ThreadDetailPagedPage({ params, searchParams }: PagedProps) {
	const { id, page } = await params;
	const sp = await searchParams;

	if (!PAGE_PARAM_RE.test(page)) notFound();
	const n = Number.parseInt(page, 10);
	if (n === 1) {
		const qs = buildPassthroughQuery(sp);
		permanentRedirect(`/threads/${id}${qs}`);
	}

	// Reuse the canonical view; `:page` is authoritative, so only carry
	// `returnTo` through (cursor / direction / last are dropped).
	return ThreadDetailPage({
		params: Promise.resolve({ id }),
		searchParams: Promise.resolve({ ...pickThreadSp(sp), page: String(n) }),
	});
}

function pickThreadSp(sp: Record<string, string | string[] | undefined>): {
	returnTo?: string;
} {
	const out: { returnTo?: string } = {};
	if (typeof sp.returnTo === "string") out.returnTo = sp.returnTo;
	return out;
}

function buildPassthroughQuery(sp: Record<string, string | string[] | undefined>): string {
	// On the page=1 → bare-path redirect, only carry `returnTo` through.
	// Cursor / last / direction are internal pagination plumbing that we
	// drop so the user lands on the canonical first page cleanly.
	const returnTo = sp.returnTo;
	if (typeof returnTo !== "string" || returnTo === "") return "";
	const params = new URLSearchParams();
	params.set("returnTo", returnTo);
	return `?${params.toString()}`;
}
