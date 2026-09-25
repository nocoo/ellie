export async function register() {
	if (
		process.env.NEXT_RUNTIME === "nodejs" &&
		process.env.NEXT_PHASE !== "phase-production-build"
	) {
		const { getMemoryRuntime } = await import("./lib/memory-runtime");
		getMemoryRuntime().start();
		const { getDailyStatistics } = await import("./lib/daily-statistics");
		getDailyStatistics().start();
	}
}
