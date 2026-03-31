// Route: /messages — Discuz-style 站内消息 (notifications & PMs) page
// Server Component shell that renders the client messages page.

import { MessagesPage } from "@/components/forum/messages-page";
import { buildMessagesBreadcrumbs } from "@/viewmodels/forum/messages";

export default function MessagesRoute() {
	const breadcrumbs = buildMessagesBreadcrumbs();

	return <MessagesPage breadcrumbs={breadcrumbs} />;
}
