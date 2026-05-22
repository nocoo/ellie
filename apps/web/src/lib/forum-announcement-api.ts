// lib/forum-announcement-api.ts — Browser-side helper for the
// moderator-driven announcement edit. Wraps the Next.js proxy route
// at /api/v1/forums/:id/announcement so callers don't have to think
// about envelope shape.

import { apiClient } from "./api-client";

export interface ForumAnnouncementUpdate {
	id: number;
	announcement: string;
}

/**
 * PATCH the forum announcement. `raw` is the moderator's textarea
 * content, sent unmodified — the Worker is the authoritative sanitizer
 * and returns the cleaned HTML which is what the UI should render
 * after a successful save.
 */
export async function setForumAnnouncement(
	forumId: number,
	raw: string,
): Promise<ForumAnnouncementUpdate> {
	const { data } = await apiClient.patch<ForumAnnouncementUpdate>(
		`/api/v1/forums/${forumId}/announcement`,
		{ announcement: raw },
	);
	return data;
}
