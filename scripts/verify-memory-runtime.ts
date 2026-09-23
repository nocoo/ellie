import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { encode } from "@auth/core/jwt";
import {
	MEMORY_CACHE_ADMIN_HEADER,
	MEMORY_CACHE_ADMIN_PATH,
	MEMORY_CACHE_WEB_PATH,
	type MemoryCacheOverviewResponse,
} from "@ellie/types";
import { chromium, expect } from "@playwright/test";
import { findOpenPort } from "./lib/find-port";
import { migrateLocalD1, seedLocalD1 } from "./lib/local-d1";
import { killTree, spawnDetached } from "./lib/process-tree";
import { TEST_WORKER_VARS } from "./lib/test-worker-vars";

const root = resolve(import.meta.dir, "..");
const owner = crypto.randomUUID();
const sandbox = await mkdtemp(join(await realpath(tmpdir()), "ellie-memory-runtime-"));
const marker = join(sandbox, ".ellie-memory-test");
await writeFile(marker, owner, { flag: "wx" });
const children: ChildProcess[] = [];
const authSecret = `local-memory-auth-${owner}`;
const memoryKey = `local-memory-admin-${owner}`;
const adminEmail = "e2e-admin@test.local";

process.env.WRANGLER_HIDE_BANNER = "true";
process.env.WRANGLER_SEND_METRICS = "false";

async function request(url: string, init?: RequestInit): Promise<Response> {
	assert.equal(new URL(url).hostname, "127.0.0.1");
	return fetch(url, {
		...init,
		redirect: "manual",
		signal: AbortSignal.timeout(init?.method === "POST" ? 45_000 : 15_000),
	});
}

async function ready(origin: string, child: ChildProcess): Promise<void> {
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		assert.equal(child.exitCode, null, "Server exited before readiness");
		try {
			const response = await request(`${origin}/api/live`);
			await response.body?.cancel();
			if (response.ok) return;
		} catch {
			// The socket is not bound during startup.
		}
		await Bun.sleep(250);
	}
	throw new Error(`Local server did not become ready: ${origin}`);
}

async function copyStandalone(app: "web" | "admin"): Promise<string> {
	const source = join(root, "apps", app);
	const target = join(sandbox, app);
	await cp(join(source, ".next/standalone"), target, {
		recursive: true,
		verbatimSymlinks: true,
		filter: (path) => !basename(path).startsWith(".env"),
	});
	const appDir = join(target, "apps", app);
	await cp(join(source, ".next/static"), join(appDir, ".next/static"), { recursive: true });
	await cp(join(source, "public"), join(appDir, "public"), { recursive: true });
	return join(appDir, "server.js");
}

function launch(command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
	const child = spawnDetached(command, args, { cwd: root, env });
	children.push(child);
	return child;
}

async function cleanup(): Promise<void> {
	for (const child of children.toReversed()) await killTree(child, "memory runtime fixture");
	assert.equal(await readFile(marker, "utf8"), owner);
	assert(!(await lstat(sandbox)).isSymbolicLink());
	assert.equal(dirname(await realpath(sandbox)), await realpath(tmpdir()));
	assert.equal(await realpath(sandbox), sandbox);
	await rm(sandbox, { recursive: true });
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		if (stopping) return;
		stopping = true;
		void cleanup().finally(() => process.exit(130));
	});
}

async function verify(): Promise<void> {
	const workerPort = await findOpenPort([0]);
	const webPort = await findOpenPort([0]);
	const adminPort = await findOpenPort([0]);
	assert.equal(new Set([workerPort, webPort, adminPort]).size, 3);
	const workerOrigin = `http://127.0.0.1:${workerPort}`;
	const webOrigin = `http://127.0.0.1:${webPort}`;
	const adminOrigin = `http://127.0.0.1:${adminPort}`;
	const webServer = await copyStandalone("web");
	const adminServer = await copyStandalone("admin");
	const wrangler = join(root, "apps/worker/node_modules/.bin/wrangler");
	const config = "apps/worker/wrangler.toml";
	const state = join(sandbox, "state");
	const db = {
		persistTo: state,
		repoRoot: root,
		wranglerBin: wrangler,
		wranglerConfig: config,
		seedFile: "scripts/seed-test-db.sql",
	};
	await migrateLocalD1(db);
	await seedLocalD1(db);
	const env = {
		PATH: process.env.PATH,
		HOME: process.env.HOME,
		TMPDIR: process.env.TMPDIR,
		WRANGLER_HIDE_BANNER: "true",
		WRANGLER_SEND_METRICS: "false",
		NODE_ENV: "production",
		HOSTNAME: "127.0.0.1",
		WORKER_API_URL: workerOrigin,
		FORUM_API_KEY: TEST_WORKER_VARS.API_KEY,
		ADMIN_API_KEY: TEST_WORKER_VARS.ADMIN_API_KEY,
		AUTH_SECRET: authSecret,
		AUTH_GOOGLE_ID: "local-test",
		AUTH_GOOGLE_SECRET: "local-test",
		ADMIN_EMAILS: adminEmail,
		MEMORY_CACHE_ADMIN_KEY: memoryKey,
		WEB_MEMORY_ADMIN_URL: webOrigin,
		WEB_STATISTICS_WRITE_KEY: TEST_WORKER_VARS.WEB_STATISTICS_WRITE_KEY,
	};
	const worker = launch(
		wrangler,
		[
			"dev",
			"-c",
			config,
			"--local",
			"--ip",
			"127.0.0.1",
			"--port",
			String(workerPort),
			"--persist-to",
			state,
			...Object.entries(TEST_WORKER_VARS).flatMap(([key, value]) => ["--var", `${key}:${value}`]),
		],
		{ ...env, NODE_ENV: "test" },
	);
	await ready(workerOrigin, worker);
	const webEnv = { ...env, PORT: String(webPort), AUTH_URL: webOrigin };
	let web = launch(process.execPath, [webServer], webEnv);
	await ready(webOrigin, web);
	const admin = launch(process.execPath, [adminServer], {
		...env,
		PORT: String(adminPort),
		AUTH_URL: adminOrigin,
	});
	await ready(adminOrigin, admin);
	const token = await encode({
		secret: authSecret,
		salt: "authjs.session-token",
		token: { sub: "memory-test-admin", email: adminEmail, name: "Memory Test Admin" },
		maxAge: 3600,
	});
	const adminHeaders = { Cookie: `authjs.session-token=${token}`, Origin: adminOrigin };
	const overview = async (): Promise<MemoryCacheOverviewResponse["data"]> => {
		const response = await request(`${adminOrigin}${MEMORY_CACHE_ADMIN_PATH}`, {
			headers: adminHeaders,
		});
		assert.equal(response.status, 200);
		assert.match(response.headers.get("cache-control") ?? "", /no-store/);
		const body = (await response.json()) as MemoryCacheOverviewResponse;
		return body.data;
	};
	const mutate = (body: object, headers = adminHeaders) =>
		request(`${adminOrigin}${MEMORY_CACHE_ADMIN_PATH}`, {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	const visit = async (path: string, headers?: HeadersInit) => {
		const response = await request(`${webOrigin}${path}`, { headers });
		assert.equal(response.status, 200);
		await response.text();
	};
	const storedViews = async () => {
		const response = await request(`${workerOrigin}/api/v1/threads/662174`, {
			headers: { "X-API-Key": TEST_WORKER_VARS.API_KEY },
		});
		assert.equal(response.status, 200);
		return ((await response.json()) as { data: { views: number } }).data.views;
	};
	for (const url of [
		`${webOrigin}${MEMORY_CACHE_WEB_PATH}`,
		`${adminOrigin}${MEMORY_CACHE_ADMIN_PATH}`,
	]) {
		const unauthorized = await request(url);
		assert.equal(unauthorized.status, 401);
		assert.match(unauthorized.headers.get("cache-control") ?? "", /no-store/);
		await unauthorized.body?.cancel();
	}
	const initial = await overview();
	const direct = await request(`${webOrigin}${MEMORY_CACHE_WEB_PATH}`, {
		headers: { [MEMORY_CACHE_ADMIN_HEADER]: memoryKey },
	});
	assert.equal(
		((await direct.json()) as MemoryCacheOverviewResponse).data.instance.id,
		initial.instance.id,
	);
	await visit("/");
	const populated = await overview();
	assert(populated.entries.some((entry) => entry.family === "site-stats"));
	await visit("/");
	const warm = await overview();
	for (const family of ["site-stats", "forum-summary"] as const) {
		const before = populated.families.find((row) => row.id === family);
		const after = warm.families.find((row) => row.id === family);
		assert(before && after);
		assert.equal(after.misses, before.misses);
		assert(after.hits > before.hits, `${family} must serve warm page reads from Web memory`);
	}
	assert.equal(
		(
			await mutate(
				{ instanceId: initial.instance.id, action: "clear" },
				{
					...adminHeaders,
					Origin: "https://invalid.example",
				},
			)
		).status,
		403,
	);
	assert.equal((await mutate({ instanceId: initial.instance.id, action: "clear" })).status, 200);
	assert.equal((await overview()).pagination.total, 0);
	await visit("/");
	assert((await overview()).entries.some((entry) => entry.family === "site-stats"));
	const baselineViews = await storedViews();
	await visit("/threads/662174", { "next-router-prefetch": "1" });
	assert.equal((await overview()).buffers.pendingViews, 0);
	await visit("/threads/662174");
	assert.equal(
		(await overview()).buffers.pendingViews,
		1,
		"Page and metadata must not double count",
	);
	assert.equal(await storedViews(), baselineViews, "Views should remain buffered before flush");
	assert.equal((await mutate({ instanceId: initial.instance.id, action: "flush" })).status, 200);
	assert.equal(await storedViews(), baselineViews + 1);
	assert.equal((await overview()).buffers.pendingViews, 0);
	await visit("/threads/662174");
	assert.equal((await overview()).buffers.pendingViews, 1);
	assert(web.pid);
	process.kill(-web.pid, "SIGKILL");
	await killTree(web, "Web restart verification");
	web = launch(process.execPath, [webServer], webEnv);
	await ready(webOrigin, web);
	const restarted = await overview();
	assert.notEqual(restarted.instance.id, initial.instance.id);
	assert.equal(restarted.buffers.pendingViews, 0);
	await visit("/threads/662174");
	assert.equal((await overview()).buffers.pendingViews, 1);
	assert.equal((await mutate({ instanceId: restarted.instance.id, action: "flush" })).status, 200);
	assert.equal(await storedViews(), baselineViews + 2, "Restart discards only unsent increments");
	assert.equal((await mutate({ instanceId: initial.instance.id, action: "clear" })).status, 409);
	await visit("/");
	const evidence = join(root, "test-results", `memory-runtime-${owner}`);
	await mkdir(evidence, { recursive: true });
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
		await context.addCookies([
			{
				name: "authjs.session-token",
				value: token,
				url: adminOrigin,
				httpOnly: true,
				sameSite: "Lax",
			},
		]);
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`${adminOrigin}/admin/statistics/memory`);
		await expect(page.getByRole("heading", { name: "内存缓存监控" }).last()).toBeVisible();
		await expect(page.getByTitle(restarted.instance.id, { exact: true })).toBeVisible();
		await page.screenshot({ path: join(evidence, "desktop-light.png"), fullPage: true });
		await page.getByRole("button", { name: "清除全部展示缓存", exact: true }).click();
		const clearResponse = page.waitForResponse(
			(response) =>
				response.url().includes(MEMORY_CACHE_ADMIN_PATH) && response.request().method() === "POST",
		);
		await page.getByRole("button", { name: "确认清除", exact: true }).click();
		assert.equal((await clearResponse).status(), 200);
		assert.equal((await overview()).pagination.total, 0);
		await expect(page.getByRole("button", { name: "确认清除", exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: "立即冲刷", exact: true }).click();
		const flushResponse = page.waitForResponse(
			(response) =>
				response.url().includes(MEMORY_CACHE_ADMIN_PATH) && response.request().method() === "POST",
		);
		await page.getByRole("button", { name: "确认冲刷", exact: true }).click();
		assert.equal((await flushResponse).status(), 200);
		await expect(page.getByRole("button", { name: "确认冲刷", exact: true })).toHaveCount(0);
		await visit("/");
		await page.getByRole("button", { name: "刷新", exact: true }).click();
		await expect(page.getByTitle(restarted.instance.id, { exact: true })).toBeVisible();
		await page.evaluate(() => localStorage.setItem("theme", "dark"));
		await page.setViewportSize({ width: 390, height: 844 });
		await page.reload();
		await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
		await expect(page.getByTitle(restarted.instance.id, { exact: true })).toBeVisible();
		assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
		await page.screenshot({ path: join(evidence, "mobile-dark.png"), fullPage: true });
		const forum = await context.newPage();
		forum.on("pageerror", (error) => errors.push(error.message));
		await forum.goto(`${webOrigin}/`);
		await expect(forum.getByRole("heading", { name: "同济闲话", exact: true })).toBeVisible();
		await forum.goto(`${webOrigin}/forums/114`);
		await expect(forum.getByTestId("thread-item")).toHaveCount(20);
		await forum.goto(`${webOrigin}/forums/114/6`);
		await expect(forum.getByText("暂无主题", { exact: true })).toBeVisible();
		await expect(forum.getByRole("button", { name: "6", exact: true }).first()).toBeDisabled();
		await expect(forum.locator('a[href="/forums/114/5"]').first()).toBeVisible();
		await forum.screenshot({ path: join(evidence, "forum-empty-page.png"), fullPage: true });
		assert.deepEqual(errors, []);
	} finally {
		await browser.close();
	}
	console.log(`Browser evidence: ${evidence}`);
	console.log(
		"Standalone Web/Admin memory ownership, management auth, clear/refill and restart verified.",
	);
}

try {
	await verify();
} finally {
	if (!stopping) {
		stopping = true;
		await cleanup();
	}
}
