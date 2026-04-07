import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	output: "standalone",
	reactStrictMode: true,
	allowedDevOrigins: ["ellie-admin.dev.hexly.ai"],
};

export default nextConfig;
