import type { HomeDigestTopic, HomeRecentTopic } from "@ellie/types";

export interface HomeShowcaseItemViewModel {
	id: number;
	subject: string;
	forumId: number;
	forumName: string;
	digest: number;
	replies: number;
	views?: number;
	userId: number;
	userName: string;
	avatarPath: string;
	at: number;
}

export function buildDigestShowcaseItem(topic: HomeDigestTopic): HomeShowcaseItemViewModel {
	const anonymous = topic.anonymousAuthor === 1;
	return {
		id: topic.id,
		subject: topic.subject,
		forumId: topic.forumId,
		forumName: topic.forumName,
		digest: topic.digest,
		replies: topic.replies,
		views: topic.views,
		userId: anonymous ? 0 : topic.authorId,
		userName: anonymous ? "匿名" : topic.authorId > 0 ? topic.authorName : "未知用户",
		avatarPath: anonymous ? "" : topic.authorAvatarPath,
		at: topic.createdAt,
	};
}

export function buildRecentShowcaseItem(topic: HomeRecentTopic): HomeShowcaseItemViewModel {
	const anonymous = topic.anonymousLastPoster === 1;
	return {
		id: topic.id,
		subject: topic.subject,
		forumId: topic.forumId,
		forumName: topic.forumName,
		digest: 0,
		replies: topic.replies,
		userId: anonymous ? 0 : topic.lastPosterId,
		userName: anonymous ? "匿名" : topic.lastPosterId > 0 ? topic.lastPoster : "未知用户",
		avatarPath: anonymous ? "" : topic.lastPosterAvatarPath,
		at: topic.lastPostAt,
	};
}
