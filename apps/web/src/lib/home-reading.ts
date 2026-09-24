import "server-only";

import type { Forum, HomeContextData, HomeDisplay, HomeStats, ReadingBucket } from "@ellie/types";
import {
	HOME_CONTEXT_PATH,
	HOME_DIGEST_TOPIC_MAX,
	HOME_SUMMARY_TOPIC_MAX,
	homeDigestGatePasses,
	UserRole,
} from "@ellie/types";
import { buildVisibleTree } from "@/viewmodels/forum/forum-list";
import { forumApi } from "./forum-api";
import { getCurrentForumUser, getWorkerJwt } from "./forum-auth";
import { composeForumDisplay, gateTopicIds, visibilityContextForBucket } from "./forum-reading";
import { getMemoryRuntime } from "./memory-runtime";

function bucketHint(jwt: string | null, role: number | undefined): ReadingBucket {
	if (!jwt) return "anon";
	if (role === UserRole.Admin) return "admin";
	if (role === UserRole.Mod || role === UserRole.SuperMod) return "staff";
	return "member";
}

function structureForum(forum: HomeDisplay["forums"][number]): Forum {
	return {
		announcement: "",
		icon: "",
		moderators: "",
		threadTypes: { enabled: false, required: false, listable: false, prefix: false },
		threads: 0,
		posts: 0,
		todayThreads: 0,
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
		lastPosterId: 0,
		lastPosterAvatar: "",
		lastPosterAvatarPath: "",
		lastThreadSubject: "",
		...forum,
	};
}

export async function loadHomeContext() {
	const [jwt, session] = await Promise.all([getWorkerJwt(), getCurrentForumUser()]);
	const runtime = getMemoryRuntime();
	const hint = bucketHint(jwt, session?.role);
	const displayToken = runtime.capture("home-display");
	const statsToken = runtime.capture("site-stats");
	const cached = runtime.peek<HomeDisplay>("home-display", hint);
	const cachedStats = runtime.peek<HomeStats>("site-stats", "site:v1");
	const summaryTopicIds = gateTopicIds(cached?.summaries.map((row) => row.topicId) ?? []);
	const digestTopicIds = gateTopicIds(cached?.digest.map((row) => row.id) ?? []);
	const overflow =
		summaryTopicIds.length > HOME_SUMMARY_TOPIC_MAX ||
		digestTopicIds.length > HOME_DIGEST_TOPIC_MAX;
	const { data } = await forumApi.postRead<HomeContextData>(
		HOME_CONTEXT_PATH,
		{
			cachedBucket: cached ? hint : null,
			includeDisplay: !cached || overflow,
			includeStats: !cachedStats,
			summaryTopicIds: overflow ? [] : summaryTopicIds,
			digestTopicIds: overflow ? [] : digestTopicIds,
		},
		jwt ?? undefined,
	);
	if (
		!data ||
		!["anon", "member", "staff", "admin"].includes(data.bucket) ||
		!Array.isArray(data.allowedForumIds) ||
		!Array.isArray(data.summaryGates) ||
		!Array.isArray(data.digestGates)
	) {
		throw new Error("Invalid homepage context");
	}
	const display = data.display ?? (data.bucket === hint && !overflow ? cached : undefined);
	const stats = data.stats ?? cachedStats;
	if (
		!display ||
		!Array.isArray(display.forums) ||
		!Array.isArray(display.summaries) ||
		!Array.isArray(display.digest) ||
		!stats
	)
		throw new Error("Incomplete homepage context");
	const allowed = new Set(data.allowedForumIds);
	const summaries = new Map(display.summaries.map((row) => [row.forumId, row]));
	const gates = new Map(data.summaryGates.map((row) => [row.topicId, row]));
	let mismatch = false;
	const forums = display.forums
		.filter((forum) => {
			if (allowed.has(forum.id)) return true;
			mismatch = true;
			return false;
		})
		.map((forum) => {
			const summary = summaries.get(forum.id);
			const resolved = composeForumDisplay({
				structure: structureForum(forum),
				summary,
				gate: summary ? gates.get(summary.topicId) : undefined,
				bucket: data.bucket,
			});
			if (resolved.topicHidden) mismatch = true;
			return resolved.forum;
		});
	const digestGates = new Map(data.digestGates.map((row) => [row.topicId, row]));
	const digest = display.digest
		.filter((topic) => {
			const gate = digestGates.get(topic.id);
			const valid = gate && homeDigestGatePasses(gate, topic, allowed);
			if (!valid) mismatch = true;
			return valid;
		})
		.map((topic) =>
			topic.anonymousAuthor === 1 ? { ...topic, authorId: 0, authorName: "" } : topic,
		);
	if (mismatch) runtime.clear("home-display", data.bucket);
	else if (
		data.display &&
		gateTopicIds(display.summaries.map((row) => row.topicId)).length <= HOME_SUMMARY_TOPIC_MAX &&
		display.digest.length <= HOME_DIGEST_TOPIC_MAX
	) {
		runtime.admit(data.bucket, display, displayToken);
	}
	if (data.stats) runtime.admit("site:v1", data.stats, statsToken);
	if (data.user) runtime.recordActivity(data.user.id);
	return {
		tree: buildVisibleTree(forums, visibilityContextForBucket(data.bucket)),
		digest,
		stats,
		user: data.user,
	};
}
