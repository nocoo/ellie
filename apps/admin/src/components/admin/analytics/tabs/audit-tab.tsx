"use client";

// Audit tab — wraps the today-visits panel. Kept as a separate file so the
// three analytics tabs (趋势 / 审计 / 登录) have a uniform shape and the
// audit module can be evolved (e.g. add admin-action audit feed) without
// touching the page-level layout.

import { TodayVisitsPanel } from "@/components/admin/analytics/today-visits-panel";

export function AuditTab(): React.JSX.Element {
	return (
		<div className="space-y-4 md:space-y-6">
			<TodayVisitsPanel />
		</div>
	);
}
