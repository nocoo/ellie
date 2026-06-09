// Route: /checkin — Daily check-in (签到) page.
//
// Server component that loads checkin status, then renders the
// interactive CheckinPanel client component.

import type { CheckinLevel, UserCheckin } from "@ellie/types";
import type { Metadata } from "next";
import Link from "next/link";
import { CheckinPanel } from "@/components/forum/checkin-panel";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import { fetchPublicSettings, getStr } from "@/viewmodels/forum/settings.server";

export const metadata: Metadata = { title: "每日签到" };

interface CheckinStatusResponse {
	checkin: UserCheckin | null;
	checkedInToday: boolean;
	level: CheckinLevel | null;
	withinWindow: boolean;
}

export default async function CheckinPage() {
	const jwt = await getWorkerJwt();
	const settings = await fetchPublicSettings();
	const homeLabel = getStr(settings, "general.site.home_label", "同济网论坛");

	if (!jwt) {
		// Not logged in — show a message with login link
		return (
			<div className="flex flex-col gap-4">
				<Breadcrumbs
					items={[{ label: homeLabel, href: "/", icon: "home" as const }, { label: "每日签到" }]}
				/>
				<Card>
					<CardHeader>
						<CardTitle>每日签到</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground">
							请先{" "}
							<Link href="/login?redirect=/checkin" className="text-primary underline">
								登录
							</Link>{" "}
							后再签到。
						</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	let initial: CheckinStatusResponse;
	try {
		const result = await forumApi.getAuth<CheckinStatusResponse>("/api/v1/checkin/status", jwt);
		initial = result.data;
	} catch {
		// API unreachable — show error card instead of a misleading "ready" state
		const breadcrumbs = [
			{ label: homeLabel, href: "/", icon: "home" as const },
			{ label: "每日签到" },
		];
		return (
			<div className="flex flex-col gap-4">
				<Breadcrumbs items={breadcrumbs} />
				<Card>
					<CardHeader>
						<CardTitle>每日签到</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground">签到状态加载失败，请稍后刷新重试。</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	const breadcrumbs = [
		{ label: homeLabel, href: "/", icon: "home" as const },
		{ label: "每日签到" },
	];

	return (
		<div className="flex flex-col gap-4">
			<Breadcrumbs items={breadcrumbs} />
			<CheckinPanel initial={initial} />
		</div>
	);
}
