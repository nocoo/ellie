"use client";

// Admin data analytics page (`/admin/analytics`).
//
// Layout:
//   1. PageHeader — page-wide
//   2. "今日 KPI" — page-wide (4 StatCards), shown across all tabs so the
//      operator always sees today's headline numbers
//   3. SegmentedSwitch — 3 tabs:
//        - 趋势 (TrendTab):  trend curves, forum distribution, checkin trend
//        - 审计 (AuditTab):  TodayVisitsPanel — per-target page-view feed
//        - 登录 (LoginTab):  LoginAttemptsPanel — login attempt audit log
//
// Each tab is a separate client component that owns its own fetch state.
// Switching tabs unmounts the previous tab, so an idle tab does not poll
// or hold stale data in memory.
//
// URL state: `?tab=trend|audit|login` so deep links land on the right tab.
// Unknown values fall back to `trend` without mutating the URL.

import { AuditTab } from "@/components/admin/analytics/tabs/audit-tab";
import { LoginTab } from "@/components/admin/analytics/tabs/login-tab";
import { TrendTab } from "@/components/admin/analytics/tabs/trend-tab";
import { SectionHeader } from "@/components/admin/section-header";
import { SegmentedSwitch } from "@/components/admin/segmented-switch";
import { StatCard } from "@/components/admin/stat-card";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { type AnalyticsOverview, parseOverview } from "@/viewmodels/admin/analytics";
import { CalendarCheck, FileText, MessageSquare, Users } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Tab identity — single source of truth for the tab keys and labels.
// ---------------------------------------------------------------------------

const ANALYTICS_TABS = ["trend", "audit", "login"] as const;
type AnalyticsTab = (typeof ANALYTICS_TABS)[number];
const DEFAULT_TAB: AnalyticsTab = "trend";

const TAB_LABELS: Record<AnalyticsTab, string> = {
	trend: "趋势",
	audit: "审计",
	login: "登录",
};

const TAB_DESCRIPTIONS: Record<AnalyticsTab, string> = {
	trend: "近期注册 / 主题 / 回复 / 签到趋势曲线与版块发帖分布。",
	audit: "今日 PV / 活跃用户与按 path_kind 切片的实时访问明细。",
	login: "登录尝试审计日志：成功 / 失败 / 风控拦截分组与详情。",
};

function parseTab(raw: string | null): AnalyticsTab {
	if (raw && (ANALYTICS_TABS as readonly string[]).includes(raw)) {
		return raw as AnalyticsTab;
	}
	return DEFAULT_TAB;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string, parse: (raw: unknown) => T): Promise<T> {
	const res = await fetch(url, { credentials: "include" });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body = (await res.json()) as { data?: unknown };
	return parse(body.data);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function AnalyticsPageInner(): React.JSX.Element {
	const searchParams = useSearchParams();
	const initialTab = useMemo(() => parseTab(searchParams.get("tab")), [searchParams]);
	const [activeTab, setActiveTab] = useState<AnalyticsTab>(initialTab);

	const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
	const [overviewError, setOverviewError] = useState<string | null>(null);

	const loadOverview = useCallback(async () => {
		try {
			setOverview(await fetchJson("/api/admin/analytics/overview", parseOverview));
			setOverviewError(null);
		} catch (e) {
			setOverviewError(e instanceof Error ? e.message : "加载失败");
		}
	}, []);

	useEffect(() => {
		loadOverview();
	}, [loadOverview]);

	const tabOptions = ANALYTICS_TABS.map((value) => ({ value, label: TAB_LABELS[value] }));

	return (
		<div className="space-y-6 md:space-y-8">
			<PageHeader
				title="数据分析"
				subtitle="今日 KPI 与近期趋势（基于业务表实时聚合，KV 缓存 60s ~ 5min）"
			/>

			<Section title="今日 KPI">
				{overviewError && (
					<div className="rounded-[var(--radius-card,14px)] bg-destructive/10 p-4 text-sm text-destructive">
						今日 KPI 加载失败：{overviewError}
					</div>
				)}
				{overview && (
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<StatCard label="今日新注册" value={overview.today.newUsers} icon={Users} />
						<StatCard label="今日新主题" value={overview.today.newThreads} icon={FileText} />
						<StatCard label="今日新回复" value={overview.today.newPosts} icon={MessageSquare} />
						<StatCard label="今日签到" value={overview.today.checkins} icon={CalendarCheck} />
					</div>
				)}
			</Section>

			<section className="space-y-3">
				<SectionHeader
					title="分析视图"
					description={TAB_DESCRIPTIONS[activeTab]}
					action={
						<SegmentedSwitch
							ariaLabel="切换数据分析视图"
							value={activeTab}
							onValueChange={setActiveTab}
							options={tabOptions}
						/>
					}
				/>

				{activeTab === "trend" && (
					<div role="tabpanel" aria-label={TAB_LABELS.trend}>
						<TrendTab />
					</div>
				)}
				{activeTab === "audit" && (
					<div role="tabpanel" aria-label={TAB_LABELS.audit}>
						<AuditTab />
					</div>
				)}
				{activeTab === "login" && (
					<div role="tabpanel" aria-label={TAB_LABELS.login}>
						<LoginTab />
					</div>
				)}
			</section>
		</div>
	);
}

export default function AnalyticsPage(): React.JSX.Element {
	// `useSearchParams` requires a Suspense boundary in the Next.js App Router.
	return (
		<Suspense fallback={<div className="text-sm text-muted-foreground">加载中...</div>}>
			<AnalyticsPageInner />
		</Suspense>
	);
}
