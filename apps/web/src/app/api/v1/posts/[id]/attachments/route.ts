// Proxy route: GET /api/v1/posts/:id/attachments
// Browser → Next.js → Worker (get post attachments)
import { forumApi } from "@/lib/forum-api";
import { NextResponse } from "next/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;

	try {
		const result = await forumApi.get<unknown>(`/api/v1/posts/${id}/attachments`);
		return NextResponse.json(result);
	} catch (err) {
		console.error("[posts/[id]/attachments/route] forumApi.get error:", err);
		if (err && typeof err === "object" && "status" in err) {
			const apiErr = err as { status: number; code: string; message: string };
			return NextResponse.json(
				{ error: { code: apiErr.code, message: apiErr.message } },
				{ status: apiErr.status },
			);
		}
		return NextResponse.json(
			{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
			{ status: 500 },
		);
	}
}
