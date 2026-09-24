import { coerceTypeIdParam } from "@/viewmodels/forum/thread-types";
import { parsePageParam } from "@/viewmodels/shared/params";

export const FORUM_LIST_LOCATION_HEADER = "x-ellie-forum-list";

export interface ForumListLocation {
	forumId: number;
	page: number;
	typeId: number | null;
}

export function forumListLocationFromUrl(url: URL): string | null {
	const match = /^\/forums\/(\d+)(?:\/([1-9]\d*))?$/.exec(url.pathname);
	if (!match) return null;
	const forumId = Number(match[1]);
	const pageValues = url.searchParams.getAll("page");
	const page = match[2]
		? Number(match[2])
		: parsePageParam(pageValues.length === 1 ? pageValues[0] : null);
	const typeValues = url.searchParams.getAll("typeId");
	const typeId = coerceTypeIdParam(typeValues.length === 1 ? typeValues[0] : null);
	if (!Number.isSafeInteger(forumId) || forumId < 1 || !Number.isSafeInteger(page)) return null;
	return `${forumId}:${page}:${Number.isSafeInteger(typeId) ? typeId : 0}`;
}

export function parseForumListLocation(value: string | null): ForumListLocation | null {
	if (!value || !/^[1-9]\d*:[1-9]\d*:(0|[1-9]\d*)$/.test(value)) return null;
	const [forumId, page, typeId] = value.split(":").map(Number);
	if (![forumId, page, typeId].every(Number.isSafeInteger)) return null;
	return { forumId, page, typeId: typeId || null };
}
