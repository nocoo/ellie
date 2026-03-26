// api/v1/moderation/route.ts — Moderator action endpoints
// Ref: 04b §API 路由边界 — /api/v1/moderation (role ∈ {1,2,3})

import { errorResponse, getMockUserRole, getRepos, isModRole, parseId } from "@/lib/api-utils";
import { NextResponse } from "next/server";

/**
 * POST /api/v1/moderation — Perform a moderation action
 *
 * Body: { action, threadId, ... }
 * Actions: "sticky", "digest", "close", "move", "delete"
 * Requires mod role (Admin=1, SuperMod=2, Mod=3).
 */
export async function POST(request: Request) {
	// Phase 2: use session role. Mock: use X-Mock-Role header.
	const role = getMockUserRole(request);
	if (role === null || !isModRole(role)) {
		return errorResponse("Forbidden: moderator role required", 403);
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return errorResponse("Invalid JSON body", 400);
	}

	const { action, threadId } = body as {
		action?: string;
		threadId?: number;
	};

	if (!action || !threadId) {
		return errorResponse("Missing required fields: action, threadId", 400);
	}

	const parsed = parseId(String(threadId), "thread ID");
	if ("error" in parsed) return parsed.error;

	const repos = getRepos();
	const thread = await repos.threads.getById(parsed.value);
	if (!thread) {
		return errorResponse("Thread not found", 404);
	}

	switch (action) {
		case "sticky":
			await repos.threads.setSticky(parsed.value, (body.level as number) ?? 1);
			break;
		case "digest":
			await repos.threads.setDigest(parsed.value, (body.level as number) ?? 1);
			break;
		case "close":
			await repos.threads.setClosed(parsed.value, (body.closed as boolean) ?? true);
			break;
		case "move":
			if (!body.targetForumId) {
				return errorResponse("Missing targetForumId for move action", 400);
			}
			await repos.threads.move(parsed.value, body.targetForumId as number);
			break;
		case "delete":
			await repos.threads.delete(parsed.value);
			break;
		default:
			return errorResponse(`Unknown action: ${action}`, 400);
	}

	return NextResponse.json({ success: true });
}
