// Proxy route: GET/POST /api/v1/messages
import { getWorkerJwt } from "@/lib/forum-auth";
import { ForumApiError, forumApi } from "@/lib/forum-api";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
	let jwt: string | null;
	try {
		jwt = await getWorkerJwt();
	} catch (err) {
		console.error("[messages/route] getWorkerJwt error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Failed to get session" } },
			{ status: 500 },
		);
	}

	if (!jwt) {
		return NextResponse.json(
			{ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
			{ status: 401 },
		);
	}

	try {
		const url = new URL(request.url);
		const result = await forumApi.getAuth<unknown>(
			"/api/v1/messages",
			jwt,
			Object.fromEntries(url.searchParams),
		);
		return NextResponse.json(result);
	} catch (err) {
		console.error("[messages/route] forumApi.getAuth error:", err);
		if (err instanceof ForumApiError) {
			return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
		}
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}

export async function POST(request: Request) {
	let jwt: string | null;
	try {
		jwt = await getWorkerJwt();
	} catch (err) {
		console.error("[messages/route] getWorkerJwt error:", err);
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Failed to get session" } },
			{ status: 500 },
		);
	}

	if (!jwt) {
		return NextResponse.json(
			{ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
			{ status: 401 },
		);
	}

	try {
		const body = await request.json();
		const result = await forumApi.postAuth<unknown>("/api/v1/messages", body, jwt);
		return NextResponse.json(result, { status: 201 });
	} catch (err) {
		console.error("[messages/route] forumApi.postAuth error:", err);
		if (err instanceof ForumApiError) {
			return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
		}
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
