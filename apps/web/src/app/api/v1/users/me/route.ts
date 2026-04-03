/**
 * Next.js API Route — proxies PATCH /api/v1/users/me to Worker with auth JWT.
 *
 * Used by ProfileEditDialog to update user profile.
 */

import { authPatch } from "@/lib/forum-auth";
import type { User } from "@ellie/types";
import { NextResponse } from "next/server";

export async function PATCH(request: Request) {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return NextResponse.json(
			{ error: { code: "INVALID_BODY", message: "Invalid JSON body" } },
			{ status: 400 },
		);
	}

	const result = await authPatch<User>("/api/v1/users/me", body);

	if ("error" in result) {
		const status = result.error === "NOT_AUTHENTICATED" ? 401 : 400;
		return NextResponse.json({ error: { code: result.error, message: result.error } }, { status });
	}

	return NextResponse.json({ data: result.data, meta: result.meta });
}
