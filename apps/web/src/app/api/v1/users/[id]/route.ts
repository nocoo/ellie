/**
 * Next.js API Route — proxies GET /api/v1/users/:id to Worker.
 *
 * Used by client-side UserPopover to fetch user profiles.
 * If user is authenticated (has JWT), passes the token to Worker so that
 * admins/mods can see IP fields.
 */

import { forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import type { PublicUser } from "@ellie/types";
import { NextResponse } from "next/server";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
	const { id } = await context.params;
	const userId = Number.parseInt(id, 10);

	if (Number.isNaN(userId) || userId <= 0) {
		return NextResponse.json(
			{ error: { code: "INVALID_ID", message: "Invalid user ID" } },
			{ status: 400 },
		);
	}

	try {
		// Try to get JWT for authenticated requests (admins see IP fields)
		const jwt = await getWorkerJwt();
		const result = jwt
			? await forumApi.getAuth<PublicUser>(`/api/v1/users/${userId}`, jwt)
			: await forumApi.get<PublicUser>(`/api/v1/users/${userId}`);
		return NextResponse.json({ data: result.data, meta: result.meta });
	} catch (err) {
		const error = err as { status?: number; code?: string; message?: string };
		return NextResponse.json(
			{ error: { code: error.code ?? "ERROR", message: error.message ?? "Failed to fetch user" } },
			{ status: error.status ?? 500 },
		);
	}
}
