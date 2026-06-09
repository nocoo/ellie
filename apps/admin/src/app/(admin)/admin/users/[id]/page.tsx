"use client";

// Admin User Detail Page — route fallback / deep-link target.
//
// Body extracted into `UserDetailPanel` (task #9 Phase B) so the same
// component can be reused inside a dialog on the users list page
// (Phase C). This file stays as the standalone route entry so existing
// bookmarks, email links, and outgoing `<Link href="/admin/users/[id]">`
// references keep working with no behaviour change — `showBack` defaults
// to true and `onChanged` / `onSearchIp` are left undefined so panel
// internals (reloadUser after mutations, router.push for IP search)
// match the pre-extraction page.

import { useParams } from "next/navigation";
import { UserDetailPanel } from "@/components/admin/user-detail-panel";

export default function UserDetailPage() {
	const params = useParams();
	const userId = Number(params.id);
	return <UserDetailPanel userId={userId} />;
}
