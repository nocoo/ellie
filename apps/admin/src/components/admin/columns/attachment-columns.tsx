"use client";

// attachment-columns — shared admin table column preset for `Attachment` rows.
//
// The main /admin/attachments page renders attachments as grid-mode cards
// (AttachmentGridItem / AttachmentListItem) rather than through
// AdminDataTable, so it does NOT consume this preset. Today's only
// consumer is /admin/recent/page.tsx AttachmentsTab. The preset exists to
// give the future "attachments list view" a shared definition when it
// arrives.

import { formatDate } from "@ellie/shared";
import { FileIcon } from "lucide-react";
import Link from "next/link";
import type { ColumnDef } from "@/components/admin/admin-data-table";
import { getAttachmentThumbUrl, getAttachmentUrl } from "@/lib/cdn";
import { type Attachment, formatFileSize } from "@/viewmodels/admin/attachments";

export type AttachmentColumnVariant = "default";

export interface BuildAttachmentColumnsOpts {
	variant?: AttachmentColumnVariant;
	/**
	 * When provided, an image preview becomes a <button> that fires the
	 * callback with the attachment (typically opening a Lightbox). When
	 * omitted, the preview renders as a plain <img>. Non-image rows always
	 * render a static <FileIcon>.
	 */
	onPreview?: (attachment: Attachment) => void;
}

/**
 * Build the shared `ColumnDef<Attachment>[]` for admin attachment tables.
 *
 * Default variant column keys: preview, filename, size, thread, createdAt.
 */
export function buildAttachmentColumns(
	opts: BuildAttachmentColumnsOpts = {},
): ColumnDef<Attachment>[] {
	const { onPreview } = opts;

	return [
		{
			key: "preview",
			header: "",
			cell: (row) => {
				if (!row.isImage) return <FileIcon className="h-6 w-6 text-muted-foreground" />;
				const thumbUrl = row.hasThumb
					? getAttachmentThumbUrl(row.filePath)
					: getAttachmentUrl(row.filePath);
				const img = (
					<img
						src={thumbUrl}
						alt={row.filename}
						className="h-10 w-10 rounded object-cover"
						loading="lazy"
					/>
				);
				if (onPreview) {
					return (
						<button type="button" className="block" onClick={() => onPreview(row)}>
							{img}
						</button>
					);
				}
				return img;
			},
			className: "w-14",
		},
		{
			key: "filename",
			header: "文件名",
			cell: (row) => (
				<span className="text-sm truncate max-w-[200px] inline-block" title={row.filename}>
					{row.filename}
				</span>
			),
		},
		{
			key: "size",
			header: "大小",
			cell: (row) => (
				<span className="text-xs text-muted-foreground">{formatFileSize(row.fileSize)}</span>
			),
		},
		{
			key: "thread",
			header: "主题",
			cell: (row) => (
				<Link
					href={`/admin/threads/${row.threadId}`}
					className="text-sm text-primary hover:underline"
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
