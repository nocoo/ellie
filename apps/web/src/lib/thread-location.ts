export const THREAD_LOCATION_HEADER = "x-ellie-thread";

export interface ThreadLocation {
	threadId: number;
	cursor?: string;
	page?: string;
	last?: string;
}

export function threadLocationFromUrl(url: URL): string | null {
	const match = /^\/threads\/(\d+)(?:\/([1-9]\d*))?$/.exec(url.pathname);
	if (!match) return null;
	const threadId = Number(match[1]);
	if (!Number.isSafeInteger(threadId) || threadId < 1) return null;
	const query = new URLSearchParams();
	if (match[2]) {
		if (!Number.isSafeInteger(Number(match[2]))) return null;
		query.set("page", match[2]);
	} else {
		for (const key of ["cursor", "page", "last"]) {
			const values = url.searchParams.getAll(key);
			if (values.length === 1 && values[0]) query.set(key, values[0]);
		}
	}
	const location = `${threadId}?${query}`;
	return location.length <= 1024 ? location : null;
}

export function parseThreadLocation(value: string | null): ThreadLocation | null {
	if (!value || value.length > 1024 || !/^[1-9]\d*\?[^?]*$/.test(value)) return null;
	const [id, query] = value.split("?");
	const threadId = Number(id);
	if (!Number.isSafeInteger(threadId)) return null;
	const params = new URLSearchParams(query);
	if ([...params.keys()].some((key) => !["cursor", "page", "last"].includes(key))) return null;
	if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) return null;
	return {
		threadId,
		cursor: params.get("cursor") || undefined,
		page: params.get("page") || undefined,
		last: params.get("last") || undefined,
	};
}
