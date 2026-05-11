// `/admin/statistics` is now a non-leaf grouping segment. The actual
// "统计计算" page moved to `/admin/statistics/recalc` so the sidebar can
// distinguish it from sibling routes (e.g. `/admin/statistics/kv`) without
// the previous prefix-collision double-highlight.
//
// Keep a server-side redirect here so any bookmarks / external links to the
// old path continue to land on the recalc page.

import { redirect } from "next/navigation";

export default function StatisticsIndexPage(): never {
	redirect("/admin/statistics/recalc");
}
