// Route: /messages/[id] — Message detail page
// Server Component shell that renders the client message detail view.

import { MessageDetailClient } from "@/components/forum/message-detail";
import { buildMessagesBreadcrumbs } from "@/viewmodels/forum/messages";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "站内信详情" };

interface MessageDetailRouteProps {
	params: Promise<{ id: string }>;
}

export default async function MessageDetailRoute({ params }: MessageDetailRouteProps) {
	const { id } = await params;
	const messageId = Number.parseInt(id, 10);
	const breadcrumbs = buildMessagesBreadcrumbs();

	if (Number.isNaN(messageId)) {
		return <div className="py-12 text-center text-sm text-muted-foreground">无效的站内信 ID</div>;
	}

	return <MessageDetailClient messageId={messageId} breadcrumbs={breadcrumbs} />;
}
