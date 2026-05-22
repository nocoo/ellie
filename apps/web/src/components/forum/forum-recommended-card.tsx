// components/forum/forum-recommended-card.tsx — per-forum "推荐主题" card
//
// Rendered between `ForumHeaderClient` and the thread list on the forum
// page. Data comes from `GET /api/v1/forums/:id/recommended-threads`
// which already applies visibility gating, the (≤6) display cap, and
// `thread_id DESC` ordering — see `apps/worker/src/handlers/recommended.ts`
// and migration 0045.
//
// Visibility:
//   threads empty  → nothing rendered (no empty-state placeholder; the
//                    card disappears entirely so non-moderator forums
//                    without recommendations look unchanged from before
//                    this feature shipped).
//   threads >= 1   → titled card listing 1..6 threads.
//
// This is a server component — no interactive state. Recommend/unrecommend
// is driven from the thread-detail mod menu; the card refreshes via
// `router.refresh()` after the toggle.

import type { RecommendedThreadItem } from "@/viewmodels/forum/recommended-threads.server";
import { ThumbsUp } from "lucide-react";
import Link from "next/link";

interface ForumRecommendedCardProps {
	threads: RecommendedThreadItem[];
}

export function ForumRecommendedCard({ threads }: ForumRecommendedCardProps) {
	if (threads.length === 0) return null;

	return (
		<div className="mt-3 rounded-sm border border-border bg-card/60 p-3">
			<div className="flex items-center gap-2 text-sm font-medium text-foreground">
				<ThumbsUp className="h-4 w-4 text-primary" />
				推荐主题
			</div>
			<ul className="mt-2 space-y-1">
				{threads.map((t) => (
					<li
						key={t.id}
						className="flex items-baseline gap-2 text-sm text-foreground/90 leading-relaxed"
					>
						<Link
							href={`/threads/${t.id}`}
							prefetch={false}
							className="truncate hover:underline hover:text-primary"
						>
							{t.subject}
						</Link>
						<span className="shrink-0 text-xs text-muted-foreground">
							{t.authorName} · {t.replies} 回复
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}
