// Route: /messages — Discuz-style 站内消息 (notifications & PMs) page
// Server Component shell that renders the client messages page.

import { MessagesPage } from "@/components/forum/messages-page";
import { buildMessagesBreadcrumbs, buildMessagesPageViewModel } from "@/viewmodels/forum/messages";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "消息" };

export default function MessagesRoute() {
	const breadcrumbs = buildMessagesBreadcrumbs();
	const vm = buildMessagesPageViewModel();

	return <MessagesPage breadcrumbs={breadcrumbs} vm={vm} />;
}
