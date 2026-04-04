// Route: /messages — Discuz-style 站内信 (private messaging) page
// Server Component shell that renders the client messages page.

import { MessagesPageClient } from "@/components/forum/messages-page";
import { buildMessagesBreadcrumbs } from "@/viewmodels/forum/messages";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "站内信" };

interface MessagesRouteProps {
	searchParams: Promise<{ box?: string; to?: string }>;
}

export default async function MessagesRoute({ searchParams }: MessagesRouteProps) {
	const params = await searchParams;
	const breadcrumbs = buildMessagesBreadcrumbs();
	const initialBox = params.box === "outbox" ? "outbox" : "inbox";
	const initialTo = params.to ? Number.parseInt(params.to, 10) : undefined;

	return (
		<MessagesPageClient
			breadcrumbs={breadcrumbs}
			initialBox={initialBox}
			initialTo={initialTo && !Number.isNaN(initialTo) ? initialTo : undefined}
		/>
	);
}
