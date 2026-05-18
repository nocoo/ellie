// Proxy route: POST /api/v1/posts/:id/rate
// Browser → Next.js → Worker (create post rating; docs/22 §6.1)
//
// Body is forwarded as-is. Auth required (Worker also enforces verified
// email + per-role dimension gate); ForumApiError is mapped through the
// shared proxy-error helper so `EMAIL_NOT_VERIFIED` keeps its flat §5.4
// shape and other gates (`PERMISSION_DENIED`, `OUT_OF_RANGE`,
// `DAILY_LIMIT_EXCEEDED`, `DUPLICATE`, `SELF_RATING`, etc.) reach the
// client unchanged.
import { proxyRoute } from "@/lib/forum-route-proxy";

export const POST = proxyRoute<{ id: string }>({
	method: "POST",
	path: ({ id }) => `/api/v1/posts/${id}/rate`,
	body: "json",
	successStatus: 201,
	debugTag: "posts/[id]/rate/route",
});
