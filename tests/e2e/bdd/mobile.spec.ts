// tests/e2e/bdd/mobile.spec.ts — Feature: Mobile Layout Drift Guards (BDD)
// Ref: docs/23-l3-bdd-refactor.md

import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { TEST_WORKER_VARS } from "../../../scripts/lib/test-worker-vars";
import { ForumPage } from "../pages/forum.page";
import { HomePage } from "../pages/home.page";
import { expect, test } from "./fixtures";

const POPULATED_FORUM_ID = 114;

async function readShowcaseLayout(section: Locator) {
	return section.evaluate((root) =>
		Array.from(root.querySelectorAll<HTMLElement>('[data-testid="home-showcase-item"]')).map(
			(row) => {
				const rowRect = row.getBoundingClientRect();
				const scrollers: string[] = [];
				const clippers: string[] = [];
				let node: HTMLElement | null = row;
				let reachedCard = false;
				while (node) {
					const style = getComputedStyle(node);
					const overflowY = style.overflowY;
					if (overflowY === "auto" || overflowY === "scroll") {
						scrollers.push(node.tagName.toLowerCase());
					}
					if (node !== row && ["auto", "scroll", "clip", "hidden"].includes(overflowY)) {
						const nodeRect = node.getBoundingClientRect();
						if (rowRect.top < nodeRect.top - 2 || rowRect.bottom > nodeRect.bottom + 2) {
							clippers.push(node.tagName.toLowerCase());
						}
					}
					if (node.hasAttribute("data-basalt-surface")) {
						reachedCard = true;
						break;
					}
					node = node.parentElement;
				}
				return { clippers, reachedCard, scrollers };
			},
		),
	);
}

test.describe("Feature: Mobile Layout Drift Guards", () => {
	test("Given I am on the homepage at mobile widths (375 / 390), Then there is no horizontal overflow, TopBar/nav-bar stay compact, and ForumCard renders 2 lines", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");
		const homePage = new HomePage(page);

		for (const vp of [
			{ width: 375, height: 667 },
			{ width: 390, height: 844 },
		]) {
			await page.setViewportSize(vp);
			await homePage.goto();
			await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
			expect(await homePage.isLoaded()).toBe(true);
			await expect(homePage.digestShowcase).toBeVisible({ timeout: 15_000 });

			const overflow = await page.evaluate(() => ({
				scroll: document.documentElement.scrollWidth,
				inner: window.innerWidth,
			}));
			expect(
				overflow.scroll,
				`width=${vp.width} overflows: scroll=${overflow.scroll} inner=${overflow.inner}`,
			).toBeLessThanOrEqual(overflow.inner + 1);
		}

		await page.setViewportSize({ width: 375, height: 667 });
		const topBar = page.locator('[data-testid="forum-top-bar"]');
		await expect(topBar).toBeVisible({ timeout: 15_000 });
		const box = await topBar.boundingBox();
		expect(box).not.toBeNull();
		if (box) expect(box.height).toBeLessThan(72);

		await expect(page.getByRole("searchbox", { name: "搜索主题", exact: true })).toBeVisible();
		await expect(page.getByTestId("site-footer")).toBeAttached({ timeout: 15_000 });
		await expect(page.getByTestId("site-footer-logo-wrap")).toBeHidden();

		const nav = page.locator('[data-testid="forum-nav-bar"]');
		await expect(nav).toBeVisible();
		const tops = await nav
			.locator('[data-testid="forum-nav-link"]')
			.evaluateAll((els: Element[]) =>
				els.map((el) => (el as HTMLElement).getBoundingClientRect().top),
			);
		expect(tops.length).toBeGreaterThan(0);
		expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(4);

		const line = page.getByTestId("online-stats-line");
		await expect(line).toBeVisible({ timeout: 10_000 });
		const text = (await line.textContent())?.trim() ?? "";
		expect(text.startsWith("在线会员")).toBe(false);
		expect(text).toMatch(/上次统计时活跃会员约\s+[\d,]+\s+人/);
		const lineHeight = await line.evaluate((el) => el.getBoundingClientRect().height);
		expect(lineHeight).toBeLessThan(32);

		const card = page.locator('[data-testid="forum-card"]').first();
		if ((await card.count()) > 0) {
			const inlineStats = page.getByTestId("forum-stats-inline");
			if ((await inlineStats.count()) > 0) {
				await expect(inlineStats.first()).toBeHidden();
			}
			const rowOrEmpty = page
				.locator('[data-testid="mobile-last-post-row"], [data-testid="mobile-last-post-empty"]')
				.first();
			await expect(rowOrEmpty).toBeVisible({ timeout: 5_000 });
		}
	});

	test("Given I open the homepage and a populated forum at 1280px desktop width, Then desktop-only chrome remains visible", async ({
		page,
		loginAs,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await loginAs("e2etest");
		await page.goto("/");
		await expect(page.getByTestId("forum-search-stats-bar")).toBeVisible();

		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		const navStrip = page.getByRole("navigation", { name: "论坛导航" });
		await expect(navStrip).toBeVisible({ timeout: 15_000 });
		const navBox = await navStrip.boundingBox();
		expect(navBox).not.toBeNull();
		if (navBox) {
			expect(navBox.x).toBeGreaterThan(0);
			expect(navBox.width).toBeLessThanOrEqual(1280 + 1);
		}

		const newPostBtn = page.getByTestId("forum-new-post-button");
		if ((await newPostBtn.count()) > 0) {
			await expect(newPostBtn.first()).toBeVisible({ timeout: 15_000 });
		}

		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await expect(page.getByTestId("site-footer-logo-wrap")).toBeVisible();
	});

	test("Given I am on a populated forum and thread at 375px, Then mobile row layout, avatar alignment, and hidden tokens hold", async ({
		page,
		loginAs,
	}) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await loginAs("e2etest");
		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);
		await expect(page.getByTestId("thread-item").first()).toBeVisible({ timeout: 15_000 });

		await expect(page.getByTestId("thread-row-stats-mobile").first()).toBeVisible();
		await expect(page.getByTestId("thread-row-stats-mobile").first()).toContainText("回复");
		await expect(page.getByTestId("thread-row-stats-mobile").first()).toContainText("浏览");

		const button = page.getByTestId("forum-new-post-button");
		for (let i = 0; i < (await button.count()); i++) {
			await expect(button.nth(i)).toBeHidden();
		}

		const avatarLink = page.getByTestId("thread-item-mobile-avatar-link").first();
		if ((await avatarLink.count()) > 0) {
			await expect(avatarLink).toBeVisible({ timeout: 15_000 });
			const siblingTops = await avatarLink
				.locator("xpath=..")
				.locator("> *")
				.evaluateAll((els: Element[]) =>
					els.map((el) => (el as HTMLElement).getBoundingClientRect().top),
				);
			expect(Math.max(...siblingTops) - Math.min(...siblingTops)).toBeLessThanOrEqual(8);
		}

		await page.getByTestId("thread-item-mobile-title-link").first().click();
		await page.waitForLoadState("load");
		await expect(page.getByTestId("breadcrumb-segment").first()).toBeVisible({
			timeout: 15_000,
		});
		const hidden = page.getByTestId("breadcrumb-segment-mobile-hidden");
		for (let i = 0; i < (await hidden.count()); i++) {
			await expect(hidden.nth(i)).toBeHidden();
		}
		const meta = page.getByTestId("post-content-meta-bar");
		for (let i = 0; i < (await meta.count()); i++) {
			await expect(meta.nth(i)).toBeHidden();
		}
	});
});

test.describe("Feature: Mobile UX Polish", () => {
	test.describe.configure({ mode: "serial" });

	test("Given the homepage at iPhone width, Then theme-color metadata matches computed header background under OS and stored themes", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ colorScheme: "light" });
		await page.goto("/");
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
		await setStoredTheme(page, null);
		await page.reload();
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		const light = await readThemeState(page);
		expect(light.isDark).toBe(false);
		expect(light.viewportMeta).toContain("viewport-fit=cover");
		expect(light.safeAreaUsed).toBe(true);
		expect(light.effectiveNorm).toBe(light.headerBgNorm);

		await setStoredTheme(page, "dark");
		await page.reload();
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
		const dark = await readThemeState(page);
		expect(dark.isDark).toBe(true);
		expect(dark.effectiveNorm).toBe(dark.headerBgNorm);
		expect(dark.effectiveNorm).not.toBe(light.headerBgNorm);
	});

	test("Given the homepage at iPhone width, Then section chips stay on one row, showcases show 5 rows, and wide/grid card density matches", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/");
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		expect(await page.getByText(/\d+\s*个分区/).count()).toBe(0);
		const sectionsNav = page.locator("[data-home-sections]");
		await expect(sectionsNav).toBeVisible({ timeout: 15_000 });
		const chips = sectionsNav.locator('a[href^="#forum-group-"]');
		await expect(chips).not.toHaveCount(0);
		const chipTops = await chips.evaluateAll((els: Element[]) =>
			els.map((el) => el.getBoundingClientRect().top),
		);
		expect(Math.max(...chipTops) - Math.min(...chipTops)).toBeLessThanOrEqual(4);

		const nav = await readNavState(page);
		expect(nav.chipWhiteSpace).toBe("nowrap");
		expect(nav.scrollerFound).toBe(true);
		expect(nav.pageScrollWidth).toBeLessThanOrEqual(nav.innerWidth + 1);

		const sections = page.locator("section[aria-label]");
		await expect(sections).toHaveCount(2);
		for (let i = 0; i < 2; i++) {
			const items = sections.nth(i).locator('[data-testid="home-showcase-item"]');
			await expect(items).toHaveCount(5);
			const layout = await readShowcaseLayout(sections.nth(i));
			expect(layout.every((row) => row.reachedCard)).toBe(true);
			expect(layout.flatMap((row) => row.scrollers)).toEqual([]);
		}

		const gridCards = page.locator('[data-testid="forum-card"]:has([data-testid="grid-row1"])');
		const wideCards = page.locator(
			'[data-testid="forum-card"]:not(:has([data-testid="grid-row1"]))',
		);
		await expect(gridCards).toHaveCount(GRID_CHILDREN);
		await expect(wideCards).toHaveCount(WIDE_CHILDREN);
	});

	test("Given I am logged in as a privileged user on a thread at iPhone width, Then toolbars stay on one line with horizontal scroll", async ({
		page,
		baseURL,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await loginPrivileged(page, baseURL ?? "http://localhost:27031");
		await page.goto("/threads/662174");
		await expect(page.getByTestId("thread-toolbar").first()).toBeVisible({ timeout: 15_000 });

		const toolbars = page.getByTestId("thread-toolbar");
		await expect(toolbars).toHaveCount(2);
		const bars = page.getByTestId("post-action-bar");
		expect(await bars.count()).toBeGreaterThanOrEqual(1);

		let overflowing = 0;
		let overflowingPosts = 0;
		for (const [testid, count] of [
			["thread-toolbar", await toolbars.count()],
			["post-action-bar", await bars.count()],
		] as const) {
			for (let i = 0; i < count; i++) {
				const state = await inspectBar(page, testid, i);
				expect(state).not.toBeNull();
				if (!state) continue;
				expect(state.flexWrap).toBe("nowrap");
				expect(state.controlSpread).toBeLessThanOrEqual(4);
				expect(state.pageScrollWidth).toBeLessThanOrEqual(state.innerWidth + 1);
				if (state.overflowing) {
					overflowing++;
					if (testid === "post-action-bar") overflowingPosts++;
					expect(state.lastControlReachable).toBe(true);
				}
			}
		}
		expect(overflowing).toBeGreaterThan(0);
		expect(overflowingPosts).toBeGreaterThan(0);
	});

	const WORKER_URL = "http://localhost:8788";
	const ADMIN_KEY = TEST_WORKER_VARS.ADMIN_API_KEY;
	const E2E = { username: "e2etest", password: "e2etest123" };
	const E2E_USER_ID = 100;
	const WIDE_CHILDREN = 2;
	const GRID_CHILDREN = 11;
	const SHOWCASE_ROWS = 7;

	let promoted = false;
	const createdForums: number[] = [];
	const createdThreads: number[] = [];

	async function adminPost(
		request: APIRequestContext,
		path: string,
		data: unknown,
	): Promise<Record<string, unknown>> {
		const res = await request.post(`${WORKER_URL}${path}`, {
			headers: { "x-api-key": ADMIN_KEY },
			data,
		});
		expect(res.ok(), `admin POST ${path} failed: ${res.status()} ${await res.text()}`).toBe(true);
		const body = (await res.json()) as { data: Record<string, unknown> };
		return body.data;
	}

	async function adminPatch(
		request: APIRequestContext,
		path: string,
		data: unknown,
	): Promise<void> {
		const res = await request.patch(`${WORKER_URL}${path}`, {
			headers: { "x-api-key": ADMIN_KEY },
			data,
		});
		expect(res.ok(), `admin PATCH ${path} failed: ${res.status()} ${await res.text()}`).toBe(true);
	}

	async function createForum(
		request: APIRequestContext,
		name: string,
		parentId: number,
	): Promise<number> {
		const created = await adminPost(request, "/api/admin/forums", {
			name,
			type: parentId === 0 ? "group" : "forum",
			parentId,
			displayOrder: 900 + parentId,
		});
		const id = Number(created.id);
		expect(Number.isInteger(id), `forum ${name} created without an id`).toBe(true);
		createdForums.push(id);
		return id;
	}

	async function loginPrivileged(page: Page, baseURL: string): Promise<void> {
		await page.context().clearCookies();
		const csrfRes = await page.request.get(`${baseURL}/api/auth/csrf`);
		expect(csrfRes.ok(), "csrf fetch failed").toBe(true);
		const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
		const loginRes = await page.request.post(`${baseURL}/api/auth/callback/credentials`, {
			form: {
				csrfToken,
				username: E2E.username,
				password: E2E.password,
				callbackUrl: `${baseURL}/`,
				json: "true",
			},
			headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
		});
		expect(loginRes.ok(), "privileged login failed").toBe(true);
		await page.goto("/");
	}

	test.beforeAll(async ({ browser, request }) => {
		const workerHost = new URL(WORKER_URL).hostname;
		expect(["localhost", "127.0.0.1", "[::1]"]).toContain(workerHost);
		const liveRes = await request.get(`${WORKER_URL}/api/live`);
		expect(liveRes.ok(), "worker /api/live is not reachable").toBe(true);
		const live = (await liveRes.json()) as { environment?: string };
		expect(live.environment).toBe("test");

		await adminPatch(request, `/api/admin/users/${E2E_USER_ID}`, { role: 2 });
		promoted = true;

		const wideGroup = await createForum(request, "移动端回归宽版组", 0);
		const gridGroup = await createForum(request, "移动端回归网格组", 0);
		let wideChild = 0;
		for (let i = 0; i < WIDE_CHILDREN; i++) {
			const id = await createForum(request, `移动端回归宽版子版${i}`, wideGroup);
			if (i === 0) wideChild = id;
		}
		for (let i = 0; i < GRID_CHILDREN; i++) {
			await createForum(request, `移动端回归网格子版${i}`, gridGroup);
		}

		const context = await browser.newContext();
		const page = await context.newPage();
		await loginPrivileged(page, "http://localhost:27031");
		for (let i = 0; i < SHOWCASE_ROWS; i++) {
			const res = await page.request.post("http://localhost:27031/api/v1/threads", {
				headers: { origin: "http://localhost:27031" },
				data: {
					forumId: wideChild,
					subject: `移动端回归主题 ${i}`,
					content: "移动端体验回归用的真实主题内容，长度足够。",
				},
			});
			expect(res.ok(), `thread create failed: ${res.status()} ${await res.text()}`).toBe(true);
			const body = (await res.json()) as { data?: { id?: number } };
			const threadId = Number(body.data?.id);
			expect(Number.isInteger(threadId)).toBe(true);
			createdThreads.push(threadId);
			await adminPatch(request, `/api/admin/threads/${threadId}`, { digest: 1 });
		}
		await context.close();
	});

	test.afterAll(async ({ request }) => {
		if (!promoted) return;
		await adminPatch(request, `/api/admin/users/${E2E_USER_ID}`, { role: 0 });
		for (const [resource, ids] of [
			["threads", createdThreads],
			["forums", createdForums],
		] as const) {
			for (const id of ids.toReversed()) {
				const response = await request.delete(`${WORKER_URL}/api/admin/${resource}/${id}`, {
					headers: { "x-api-key": ADMIN_KEY },
				});
				expect(response.ok(), `cleanup ${resource}/${id} failed`).toBe(true);
			}
		}
	});
});

async function setStoredTheme(page: Page, theme: "light" | "dark" | null): Promise<void> {
	await page.evaluate((value) => {
		try {
			if (value === null) localStorage.removeItem("theme");
			else localStorage.setItem("theme", value);
		} catch {
			/* storage unavailable */
		}
	}, theme);
}

interface ThemeState {
	effective: string;
	headerBg: string;
	headerBgNorm: string;
	effectiveNorm: string;
	isDark: boolean;
	viewportMeta: string;
	safeAreaUsed: boolean;
}

async function readThemeState(page: Page): Promise<ThemeState> {
	return page.evaluate(() => {
		const norm = (css: string): string => {
			const probe = document.createElement("span");
			probe.style.color = "";
			probe.style.color = css;
			if (!probe.style.color) return "";
			document.body.appendChild(probe);
			const computed = getComputedStyle(probe).color;
			probe.remove();
			return computed;
		};
		const metas = Array.from(document.querySelectorAll('meta[name="theme-color"]'));
		const effective =
			metas
				.find((m) => {
					const media = m.getAttribute("media");
					return !media || window.matchMedia(media).matches;
				})
				?.getAttribute("content") ?? "";
		const header = document.querySelector("header");
		const headerBg = header ? getComputedStyle(header).backgroundColor : "";
		let css = "";
		for (const sheet of Array.from(document.styleSheets)) {
			try {
				for (const rule of Array.from(sheet.cssRules)) css += rule.cssText;
			} catch {
				/* cross-origin sheet */
			}
		}
		return {
			effective,
			headerBg,
			headerBgNorm: norm(headerBg),
			effectiveNorm: norm(effective),
			isDark: document.documentElement.classList.contains("dark"),
			viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
			safeAreaUsed: css.includes("safe-area-inset"),
		};
	});
}

interface NavState {
	chipWhiteSpace: string;
	scrollerFound: boolean;
	pageScrollWidth: number;
	innerWidth: number;
}

async function readNavState(page: Page): Promise<NavState> {
	return page.evaluate(() => {
		const el = document.querySelector("[data-home-sections]");
		const chip = el?.querySelector('a[href^="#forum-group-"]');
		let scroller: HTMLElement | null = null;
		let node: HTMLElement | null = chip?.parentElement ?? null;
		while (node && !scroller) {
			const cs = getComputedStyle(node);
			if (cs.overflowX === "auto" || cs.overflowX === "scroll") scroller = node;
			if (node === el) break;
			node = node.parentElement;
		}
		return {
			chipWhiteSpace: chip ? getComputedStyle(chip).whiteSpace : "",
			scrollerFound: scroller !== null,
			pageScrollWidth: document.documentElement.scrollWidth,
			innerWidth: window.innerWidth,
		};
	});
}

interface BarState {
	flexWrap: string;
	overflowing: boolean;
	controlSpread: number;
	lastControlReachable: boolean;
	pageScrollWidth: number;
	innerWidth: number;
}

async function inspectBar(page: Page, testid: string, index: number): Promise<BarState | null> {
	return page.evaluate(
		({ testid, index }) => {
			const el = document.querySelectorAll(`[data-testid="${testid}"]`)[index] as
				| HTMLElement
				| undefined;
			if (!el) return null;
			const cs = getComputedStyle(el);
			const rect = el.getBoundingClientRect();
			const controlTops = Array.from(el.querySelectorAll("button, a")).map(
				(c) => c.getBoundingClientRect().top,
			);
			const spread = controlTops.length ? Math.max(...controlTops) - Math.min(...controlTops) : 0;
			const overflowing = el.scrollWidth > el.clientWidth + 1;
			let lastControlReachable = true;
			if (overflowing) {
				el.scrollLeft = el.scrollWidth;
				const controls = Array.from(el.querySelectorAll("button, a"));
				const last = controls[controls.length - 1];
				if (last) {
					lastControlReachable = last.getBoundingClientRect().right <= rect.right + 1;
				}
				el.scrollLeft = 0;
			}
			return {
				flexWrap: cs.flexWrap,
				overflowing,
				controlSpread: spread,
				lastControlReachable,
				pageScrollWidth: document.documentElement.scrollWidth,
				innerWidth: window.innerWidth,
			};
		},
		{ testid, index },
	);
}
