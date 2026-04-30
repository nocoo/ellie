import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
	"vitest.config.ts",
	"apps/worker/vitest.config.ts",
	"apps/admin/vitest.config.ts",
]);
