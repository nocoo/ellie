"use client";

// post-columns — shared admin table column preset for `Post` rows.
//
// There is no dedicated /admin/posts route; the only current consumer is
// /admin/recent/page.tsx PostsTab. The single-variant module exists so
// that when a top-level posts management page lands, its column
// definitions live in one place from day one.

import { formatDate } from "@ellie/shared";
import Link from "next/link";
import type { ColumnDef } from "@/components/admin/admin-data-table";
import type { Post } from "@/viewmodels/admin/posts";

export type PostColumnVariant = "default";

export interface BuildPostColumnsOpts {
	variant?: PostColumnVariant;
}

/**
 * Build the shared `ColumnDef<Post>[]` for admin post tables.
 *
 * Default variant column keys: content, author, thread, createdAt.
 * The `variant` parameter exists for parity with the other preset
 * builders; today only "default" is supported.
 */
export function buildPostColumns(_opts: BuildPostColumnsOpts = {}): ColumnDef<Post>[] {
	return [
		{
			key: "content",
			header: "内容",
			cell: (row) => (
				<span className="line-clamp-2 text-sm">
					{(row.content ?? "").replace(/\[.*?\]/g, "").slice(0, 120)}
				</span>
			),
		},
		{
			key: "author",
			header: "作者",
			cell: (row) => (
				<Link
					href={`/admin/users/${row.authorId}`}
					className="text-sm text-primary hover:underline whitespace-nowrap"
				>
					{row.authorName}
				</Link>
			),
		},
		{
			key: "thread",
			header: "所在主题",
			cell: (row) => (
				<Link
					href={`/admin/threads/${row.threadId}`}
					className="text-sm text-primary hover:underline whitespace-nowrap"
				>
					#{row.threadId}
				</Link>
			),
		},
		{
			key: "createdAt",
			header: "创建时间",
			cell: (row) => formatDate(row.createdAt),
		},
	];
}
