import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = resolve(__dirname, "../../scripts/audit-l2-coverage.ts");
const FORUM_ROUTE = 'if (path === "/api/v1/forums" && request.method === "GET") {}';
const FORUM_CALL = 'workerFetch(env, "/api/v1/forums", { method: "GET" });';
const AUTH_PROBE = 'workerFetch(env, "/foo/bar", { method: "GET" });';

let root: string;

function write(path: string, content: string) {
	const file = join(root, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content);
}

function audit(...args: string[]) {
	return spawnSync("bun", [join(root, "scripts/audit-l2-coverage.ts"), ...args], {
		cwd: root,
		encoding: "utf8",
	});
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "ellie-l2-audit-"));
	mkdirSync(join(root, "scripts"));
	mkdirSync(join(root, "docs"));
	copyFileSync(SCRIPT, join(root, "scripts/audit-l2-coverage.ts"));
	write("apps/worker/src/index.ts", FORUM_ROUTE);
	write("tests/integration/fast/routes.fast.test.ts", FORUM_CALL);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("L2 audit CLI keeps route coverage strict", () => {
	test("keeps a fixed GET separate from the adjacent raw POST", () => {
		write(
			"apps/worker/src/index.ts",
			`${FORUM_ROUTE}\nif (path === "/api/admin/visits" && request.method === "GET") {}\nif (path === "/api/v1/analytics" && request.method === "POST") {}`,
		);
		write(
			"tests/integration/http/analytics.test.ts",
			[
				'await adminGet("/api/admin/visits");',
				'await fetch("http://localhost:17031/api/v1/analytics", {',
				'  method: "POST",',
				"});",
			].join("\n"),
		);
		const result = audit("--strict-coverage");
		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/Routes hit\s+: 3/);
		expect(result.stdout).toMatch(/Unmatched calls\s+: 0/);
	});

	test.each([
		["workerPost", "POST"],
		["workerPatch", "PATCH"],
		["workerDelete", "DELETE"],
		["adminGet", "GET"],
		["adminPost", "POST"],
		["adminPatch", "PATCH"],
		["adminPut", "PUT"],
		["adminDelete", "DELETE"],
	])("%s ignores method fields in payloads", (helper, method) => {
		write(
			"apps/worker/src/index.ts",
			`if (path === "/api/v1/forums" && request.method === "${method}") {}`,
		);
		write(
			"tests/integration/fast/routes.fast.test.ts",
			`${helper}("/api/v1/forums", { method: "OPTIONS" });`,
		);
		const result = audit("--strict-coverage");
		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/Routes hit\s+: 1/);
		expect(result.stdout).toMatch(/Unmatched calls\s+: 0/);
	});

	test.each(["workerFetch", "workerAuthFetch", "adminFetch"])(
		"%s keeps explicit RequestInit method overrides",
		(helper) => {
			write(
				"apps/worker/src/index.ts",
				'if (path === "/api/v1/forums" && request.method === "PATCH") {}',
			);
			write(
				"tests/integration/fast/routes.fast.test.ts",
				`${helper}(env, "/api/v1/forums", {\n  method: "PATCH"\n});`,
			);
			const result = audit("--strict-coverage");
			expect(result.status).toBe(0);
			expect(result.stdout).toMatch(/Routes hit\s+: 1/);
			expect(result.stdout).toMatch(/Unmatched calls\s+: 0/);
		},
	);

	test("reports the two known negative auth probes separately in stdout and the generated matrix", () => {
		write("tests/integration/fast/api-key.fast.test.ts", `${AUTH_PROBE}\n${AUTH_PROBE}`);
		const result = audit("--strict-coverage", "--write");
		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/Total routes\s+: 1/);
		expect(result.stdout).toMatch(/Routes hit\s+: 1/);
		expect(result.stdout).toMatch(/Exemptions\s+: 0/);
		expect(result.stdout).toMatch(/Unmatched calls\s+: 0/);
		expect(result.stdout).toMatch(/Negative boundary probes\s*: 2/);
		const matrix = readFileSync(join(root, "docs/18-l2-coverage-matrix.md"), "utf8");
		expect(matrix).toContain("| Routes hit | **1** (100.00%) |");
		expect(matrix).toContain("| Exemptions | 0 |");
		expect(matrix).toContain("| Negative boundary probes (not endpoint coverage) | 2 |");
		expect(matrix).toContain("## 7. Negative boundary probes");
		expect(matrix).toContain("tests/integration/fast/api-key.fast.test.ts:1");
		expect(matrix).toContain("tests/integration/fast/api-key.fast.test.ts:2");
	});

	test("counts rejected snapshot preflight separately without covering GET or POST", () => {
		write(
			"apps/worker/src/index.ts",
			`${FORUM_ROUTE}\nif (path === "/api/internal/statistics/snapshot" && request.method === "POST") {}`,
		);
		write(
			"tests/integration/http/memory-statistics.test.ts",
			'fetch("http://localhost:17031/api/internal/statistics/snapshot", {method: "OPTIONS"});',
		);
		const result = audit("--strict-coverage");
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/Negative boundary probes\s*: 1/);
		expect(result.stdout).toMatch(/Routes uncovered\s+: 1/);
	});

	test("auth probes cannot cover a missing route or remove a route from the denominator", () => {
		write(
			"apps/worker/src/index.ts",
			`${FORUM_ROUTE}\nif (path === "/foo/bar" && request.method === "GET") {}`,
		);
		write("tests/integration/fast/api-key.fast.test.ts", AUTH_PROBE);
		const result = audit("--strict-coverage");
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/Total routes\s+: 2/);
		expect(result.stdout).toMatch(/Routes hit\s+: 1/);
		expect(result.stdout).toMatch(/Routes uncovered\s+: 1/);
		expect(result.stderr).toContain("1 non-exempt route(s) uncovered");
	});

	test.each([
		["tests/integration/fast/api-key.fast.test.ts", "/api/v1/missing", "GET"],
		["tests/integration/fast/routes.fast.test.ts", "/foo/bar", "GET"],
		["tests/integration/fast/api-key.fast.test.ts", "/foo/bar", "POST"],
		["tests/integration/fast/routes.fast.test.ts", "/api/v1/forums", "POST"],
	])("keeps unmatched calls strict: %s %s %s", (file, path, method) => {
		write(file, `${FORUM_CALL}\nworkerFetch(env, "${path}", { method: "${method}" });`);
		const result = audit("--strict-coverage");
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/Routes hit\s+: 1/);
		expect(result.stdout).toMatch(/Unmatched calls\s+: 1/);
		expect(result.stderr).toContain("1 L2 call(s) unmatched");
	});

	test("matches numeric resource templates without treating dynamic action names as wildcard routes", () => {
		write(
			"apps/worker/src/index.ts",
			String.raw`if (path.match(/^\/api\/v1\/threads\/\d+$/) && request.method === "PATCH") {}
if (path.match(/^\/api\/admin\/users\/\d+\/ban$/) && request.method === "POST") {}`,
		);
		write(
			"tests/integration/fast/routes.fast.test.ts",
			[
				// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture code must retain the template expression for the static parser.
				'workerFetch(env, `/api/v1/threads/${id}`, { method: "PATCH" });',
				// biome-ignore lint/suspicious/noTemplateCurlyInString: unresolved action must remain literal fixture code.
				'workerFetch(env, `/api/admin/users/42/${action}`, { method: "POST" });',
			].join("\n"),
		);
		const unresolved = audit("--strict-coverage");
		expect(unresolved.status).toBe(1);
		expect(unresolved.stdout).toMatch(/Routes hit\s+: 1/);
		expect(unresolved.stdout).toMatch(/Unmatched calls\s+: 1/);
		write(
			"tests/integration/fast/routes.fast.test.ts",
			[
				// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture code must retain the template expression for the static parser.
				'workerFetch(env, `/api/v1/threads/${id}`, { method: "PATCH" });',
				'workerFetch(env, "/api/admin/users/42/ban", { method: "POST" });',
			].join("\n"),
		);
		const concrete = audit("--strict-coverage");
		expect(concrete.status).toBe(0);
		expect(concrete.stdout).toMatch(/Routes hit\s+: 2/);
		expect(concrete.stdout).toMatch(/Unmatched calls\s+: 0/);
	});
});
