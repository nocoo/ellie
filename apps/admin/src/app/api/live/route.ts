import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET() {
	const timestamp = new Date().toISOString();
	const uptime = Math.floor(process.uptime());

	return Response.json(
		{
			status: "ok",
			version: APP_VERSION,
			component: "ellie-admin",
			timestamp,
			uptime,
		},
		{ status: 200, headers: { "Cache-Control": "no-store" } },
	);
}
