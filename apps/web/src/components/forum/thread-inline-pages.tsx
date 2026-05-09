// components/forum/thread-inline-pages.tsx — Discuz inline page links
// Displayed to the right of the thread title: ...2 3 4 5..8
// Matches forumdisplay_list.htm <span class="tps">

import {
	type InlinePageItem,
	getInlinePageItems,
	getThreadPageCount,
	getThreadPageUrl,
} from "@/viewmodels/forum/thread-list";
import Link from "next/link";

interface ThreadInlinePagesProps {
	threadId: number;
	replies: number;
	postsPerPage: number;
}

export function ThreadInlinePages({ threadId, replies, postsPerPage }: ThreadInlinePagesProps) {
	const pageCount = getThreadPageCount(replies, postsPerPage);
	if (pageCount <= 1) return null;

	const items = getInlinePageItems(pageCount);

	return (
		<span className="inline-flex items-center gap-0.5 shrink-0 text-xs text-muted-foreground">
			{items.map((item, i) => (
				<InlinePageLink key={itemKey(item, i)} item={item} threadId={threadId} />
			))}
		</span>
	);
}

function InlinePageLink({ item, threadId }: { item: InlinePageItem; threadId: number }) {
	if (item === "ellipsis") {
		return <span className="px-0.5 select-none">...</span>;
	}
	return (
		<Link
			href={getThreadPageUrl(threadId, item)}
			prefetch={false}
			className="px-0.5 hover:text-primary transition-colors tabular-nums"
		>
			{item}
		</Link>
	);
}

function itemKey(item: InlinePageItem, index: number): string {
	return item === "ellipsis" ? `e${index}` : `p${item}`;
}
