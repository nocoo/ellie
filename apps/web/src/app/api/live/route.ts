import { extractClientIp } from "@/lib/client-ip";
import { APP_VERSION } from "@/lib/version";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
	const timestamp = new Date().toISOString();
	const uptime = Math.floor(process.uptime());
	const h = await headers();
	const resolvedIp = extractClientIp(h);
	const debugHeaders = {
		"x-forwarded-client-ip": h.get("x-forwarded-client-ip"),
		"cf-connecting-ip": h.get("cf-connecting-ip"),
		"x-forwarded-for": h.get("x-forwarded-for"),
		"x-real-ip": h.get("x-real-ip"),
	};

	return Response.json(
		{
			status: "ok",
			version: APP_VERSION,
			component: "ellie-web",
			timestamp,
			uptime,
			resolvedIp,
			debugHeaders,
		},
		{ status: 200, headers: { "Cache-Control": "no-store" } },
	);
}
