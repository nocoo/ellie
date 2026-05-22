import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	output: "standalone",
	allowedDevOrigins: ["ellie.dev.hexly.ai"],

	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "t.no.mt",
				pathname: "/static/image/**",
			},
		],
	},

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

	// Legacy Discuz URL → canonical 301.
	//
	// HTML / `.php?mod=...` legacy shapes (forum-NNN-N.html,
	// thread-NNN-N-N.html, forum.php?mod=forumdisplay|viewthread, plus
	// query-page canonicalize of /forums/:id?page=N → /forums/:id/N) all
	// live in `src/lib/legacy-url.ts` (`resolveLegacyDiscuzRedirect`)
	// and are dispatched by `proxy.ts` BEFORE auth / analytics. Putting
	// them here would (a) bypass that ordering and (b) make it hard to
	// drop legacy query junk (`extra`, `mobile`, `from`, `fromuid`) —
	// Next `redirects()` is best-suited for whole-URL static rewrites
	// without query trust concerns.
	//
	// The two `*.php?uid=...` redirects below carry NO trust-edge query
	// (just `uid`) and stay here for that reason.
	async redirects() {
		return [
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
