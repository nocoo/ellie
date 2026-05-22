import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * PATCH /api/v1/forums/:id/announcement
 *
 * Forwards moderator-driven announcement edits to the Worker. The
 * Worker enforces the real permission gate (moderation middleware +
 * `canModerate`) and runs the authoritative sanitizer; this proxy only
 * adds CSRF + session JWT.
 */
export const PATCH = proxyRoute<{ id: string }>({
	method: "PATCH",
	path: ({ id }) => `/api/v1/forums/${id}/announcement`,
	body: "json",
	debugTag: "forums/[id]/announcement/route",
});
