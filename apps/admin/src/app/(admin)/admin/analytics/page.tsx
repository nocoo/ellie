"use client";

// Admin data analytics page (`/admin/analytics`).
//
// Layout:
//   1. PageHeader — page-wide
//   2. "今日 KPI" — page-wide (4 StatCards), shown across all tabs so the
//      operator always sees today's headline numbers
//   3. Basalt Tabs — 3 tabs:
//        - 趋势 (TrendTab):  trend curves, forum distribution, checkin trend
//        - 审计 (AuditTab):  TodayVisitsPanel — per-target page-view feed
//        - 登录 (LoginTab):  LoginAttemptsPanel — login attempt audit log
//
// Each tab is a separate client component that owns its own fetch state.
// Switching tabs unmounts the previous tab, so an idle tab does not poll
// or hold stale data in memory.
//
// URL state: `?tab=trend|audit|login`. Two-way binding:
//   - On mount and whenever the URL changes externally (back/forward,
//     direct edit, programmatic navigation) we read `?tab=` and sync
//     local state.
//   - On click the active tab is written back via `router.replace` so
//     reload / link sharing / browser history all preserve the choice.
//   - Unknown values fall back to `trend` (the next click writes the
//     normalized value back to the URL).

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import {
	BarChart3,
	CalendarCheck,
	ChartNoAxesCombined,
	FileText,
	Globe,
	MessageSquare,
	ShieldCheck,
	Users,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { AuditTab } from "@/components/admin/analytics/tabs/audit-tab";
import { LoginTab } from "@/components/admin/analytics/tabs/login-tab";
import { TrendTab } from "@/components/admin/analytics/tabs/trend-tab";
import { StatCard } from "@/components/admin/stat-card";

import { type AnalyticsOverview, parseOverview } from "@/viewmodels/admin/analytics";

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
	const pathname = usePathname();
	const router = useRouter();
	const initialTab = useMemo(() => parseTab(searchParams.get("tab")), [searchParams]);
	const [activeTab, setActiveTab] = useState<AnalyticsTab>(initialTab);

	// Keep local state in sync if the URL changes externally (back/forward,
	// direct address-bar edit, or programmatic navigation).
	useEffect(() => {
		setActiveTab(initialTab);
	}, [initialTab]);

	const handleTabChange = useCallback(
		(next: AnalyticsTab) => {
			setActiveTab(next);
			// Mirror the tab into the URL so the choice survives reload /
			// link sharing / browser history. Use `replace` to avoid piling
			// up history entries on every click. Preserve any other query
			// params that the page might rely on in the future.
			const params = new URLSearchParams(searchParams.toString());
			params.set("tab", next);
			const qs = params.toString();
			router.replace(qs ? `${pathname}?${qs}` : pathname);
		},
		[searchParams, pathname, router],
	);

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
		<div className="space-y-5">
			<PageHeader
				title={
					<span className="flex items-center gap-2.5">
						<BarChart3
							className="h-6 w-6 text-basalt-primary"
							aria-hidden="true"
							strokeWidth={1.5}
						/>
						数据分析
					</span>
				}
				description="社区增长、访问行为与认证审计 · 上海时区"
			/>

			<SectionRule title="今日 KPI">
				{overviewError && (
					<AdminInlineMessage variant="error" text={`今日 KPI 加载失败：${overviewError}`} />
				)}
				{overview && (
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						<StatCard label="今日新注册" value={overview.today.newUsers} icon={Users} />
						<StatCard label="今日新主题" value={overview.today.newThreads} icon={FileText} />
						<StatCard label="今日新回复" value={overview.today.newPosts} icon={MessageSquare} />
						<StatCard label="今日签到" value={overview.today.checkins} icon={CalendarCheck} />
					</div>
				)}
			</SectionRule>

			<Tabs
				value={activeTab}
				onValueChange={(value) => handleTabChange(parseTab(value))}
				className="space-y-3"
			>
				<SectionRule
					title="分析视图"
					hint={TAB_DESCRIPTIONS[activeTab]}
					actions={
						<TabsList aria-label="切换数据分析视图" className="max-w-full overflow-x-auto">
							{tabOptions.map((option) => (
								<TabsTrigger key={option.value} value={option.value}>
									{option.value === "trend" ? (
										<ChartNoAxesCombined className="h-3.5 w-3.5" aria-hidden="true" />
									) : option.value === "audit" ? (
										<Globe className="h-3.5 w-3.5" aria-hidden="true" />
									) : (
										<ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
									)}
									{option.label}
								</TabsTrigger>
							))}
						</TabsList>
					}
				/>

				<TabsContent value="trend">
					<TrendTab />
				</TabsContent>
				<TabsContent value="audit">
					<AuditTab />
				</TabsContent>
				<TabsContent value="login">
					<LoginTab />
				</TabsContent>
			</Tabs>
		</div>
	);
}

export default function AnalyticsPage(): React.JSX.Element {
	// `useSearchParams` requires a Suspense boundary in the Next.js App Router.
	return (
		<Suspense fallback={<div className="text-sm text-basalt-muted-foreground">加载中...</div>}>
			<AnalyticsPageInner />
		</Suspense>
	);
}
