import { NextResponse } from "next/server";
import { resolveTrustedClientIp } from "@/lib/client-ip";
import { isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { forumApi } from "@/lib/forum-api";

const ACTIONS = new Set(["challenge", "redeem"]);

export async function POST(
	request: Request,
	ctx: { params: Promise<{ action: string }> },
): Promise<Response> {
	if (isMutatingMethod(request.method) && !validateOrigin(request)) {
		return NextResponse.json(
			{ error: { code: "CSRF_REJECTED", message: "Origin not allowed" } },
			{ status: 403 },
		);
	}

	const { action } = await ctx.params;
	if (!ACTIONS.has(action)) {
		return NextResponse.json(
			{ error: { code: "NOT_FOUND", message: "Unknown cap action" } },
			{ status: 404 },
		);
	}

	const ip = resolveTrustedClientIp(request);
	if (!ip) {
		return NextResponse.json({ success: false, error: "missing_client_ip" }, { status: 400 });
	}

	let body: unknown = {};
	try {
		body = await request.json();
	} catch {
		body = {};
	}

	const upstream = await forumApi.postRaw(`/api/v1/cap/${action}`, body, {
		ip,
		userAgent: request.headers.get("User-Agent") || undefined,
	});
	return new NextResponse(await upstream.text(), {
		status: upstream.status,
		headers: { "Content-Type": "application/json" },
	});
}
