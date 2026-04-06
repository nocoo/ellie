import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	allowedDevOrigins: ["ellie.dev.hexly.ai"],

	// Security headers
	async headers() {
		return [
			{
				// Apply to all routes
				source: "/:path*",
				headers: [
					{
						key: "X-Frame-Options",
						value: "DENY",
					},
					{
						key: "X-Content-Type-Options",
						value: "nosniff",
					},
					{
						key: "Referrer-Policy",
						value: "strict-origin-when-cross-origin",
					},
					{
						key: "Permissions-Policy",
						value: "camera=(), microphone=(), geolocation=()",
					},
					{
						key: "X-XSS-Protection",
						value: "1; mode=block",
					},
				],
			},
		];
	},

	// Redirect legacy Discuz URLs to new paths
	async redirects() {
		return [
			// thread-{tid}-{page}-{extra}.html → /threads/{tid}
			// Examples: thread-1074348-1-1.html, thread-123-2-1.html
			{
				source: "/thread-:tid(\\d+)-:page(\\d+)-:extra(\\d+).html",
				destination: "/threads/:tid",
				permanent: true,
			},
			// forum-{fid}-{page}.html → /forums/{fid}
			// Examples: forum-335-1.html, forum-42-2.html
			{
				source: "/forum-:fid(\\d+)-:page(\\d+).html",
				destination: "/forums/:fid",
				permanent: true,
			},
			// viewthread.php?tid=XXX → /threads/XXX
			{
				source: "/viewthread.php",
				has: [{ type: "query", key: "tid", value: "(?<tid>\\d+)" }],
				destination: "/threads/:tid",
				permanent: true,
			},
			// forumdisplay.php?fid=XXX → /forums/XXX
			{
				source: "/forumdisplay.php",
				has: [{ type: "query", key: "fid", value: "(?<fid>\\d+)" }],
				destination: "/forums/:fid",
				permanent: true,
			},
			// space.php?uid=XXX → /users/XXX
			{
				source: "/space.php",
				has: [{ type: "query", key: "uid", value: "(?<uid>\\d+)" }],
				destination: "/users/:uid",
				permanent: true,
			},
			// home.php?mod=space&uid=XXX → /users/XXX
			{
				source: "/home.php",
				has: [
					{ type: "query", key: "mod", value: "space" },
					{ type: "query", key: "uid", value: "(?<uid>\\d+)" },
				],
				destination: "/users/:uid",
				permanent: true,
			},
		];
	},
};

export default nextConfig;
