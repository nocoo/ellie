// Route: /messages — Discuz-style 站内信 (private messaging) page
// Server Component shell that renders the client messages page.

import { MessagesPageClient } from "@/components/forum/messages-page";
import { forumApi } from "@/lib/forum-api";
import { buildMessagesBreadcrumbs } from "@/viewmodels/forum/messages";
import { fetchPublicSettings, getStr } from "@/viewmodels/forum/settings.server";
import type { PublicUser } from "@ellie/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "站内信" };

interface MessagesRouteProps {
	searchParams: Promise<{ box?: string; to?: string }>;
}

/** Fetch username by ID for pre-filling compose dialog */
async function getRecipientInfo(
	userId: number,
): Promise<{ id: number; username: string } | undefined> {
	try {
		const { data: user } = await forumApi.get<PublicUser>(`/api/v1/users/${userId}`);
		return { id: user.id, username: user.username };
	} catch {
		return undefined;
	}
}

export default async function MessagesRoute({ searchParams }: MessagesRouteProps) {
	const params = await searchParams;
	const settings = await fetchPublicSettings();
	const homeLabel = getStr(settings, "general.site.home_label", "同济网论坛");
	const breadcrumbs = buildMessagesBreadcrumbs(homeLabel);
	const initialBox = params.box === "outbox" ? "outbox" : "inbox";
	const toId = params.to ? Number.parseInt(params.to, 10) : undefined;

	// Fetch recipient info if ?to=N is provided
	const initialRecipient = toId && !Number.isNaN(toId) ? await getRecipientInfo(toId) : undefined;

	return (
		<MessagesPageClient
			breadcrumbs={breadcrumbs}
			initialBox={initialBox}
			initialRecipient={initialRecipient}
		/>
	);
}
