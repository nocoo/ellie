"use client";

// attachment-columns — shared admin table column preset for `Attachment` rows.
//
// Shared by the attachment library list view and recent attachments.

import { formatDate } from "@ellie/shared";
import { Button } from "@nocoo/basalt";
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
 * Default variant column keys: preview, filename, size, downloads, author, thread, createdAt.
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
				if (!row.isImage) return <FileIcon className="h-6 w-6 text-basalt-muted-foreground" />;
				const thumbUrl = row.hasThumb
					? getAttachmentThumbUrl(row.filePath)
					: getAttachmentUrl(row.filePath);
				const img = (
					<img
						src={thumbUrl}
						alt={row.filename}
						className="h-8 w-8 rounded object-cover"
						loading="lazy"
					/>
				);
				if (onPreview) {
					return (
						<Button
							type="button"
							className="block h-auto w-auto p-0"
							onClick={() => onPreview(row)}
							aria-label={`预览 ${row.filename}`}
							variant="ghost"
							size="sm"
						>
							{img}
						</Button>
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
				<div>
					<span className="block max-w-64 truncate text-sm font-medium" title={row.filename}>
						{row.filename}
					</span>
					<span className="text-[11px] text-basalt-muted-foreground">
						#{row.id} · {row.isImage ? "图片" : "文件"}
					</span>
				</div>
			),
		},
		{
			key: "size",
			header: "大小",
			className: "text-right tabular-nums",
			cell: (row) => (
				<span className="text-xs text-basalt-muted-foreground">{formatFileSize(row.fileSize)}</span>
			),
		},
		{
			key: "downloads",
			header: "下载",
			className: "text-right tabular-nums",
			cell: (row) => row.downloads ?? 0,
		},
		{
			key: "author",
			header: "上传者",
			cell: (row) =>
				row.authorId > 0 ? (
					<Link
						href={`/admin/users/${row.authorId}`}
						className="text-basalt-primary hover:underline"
					>
						UID {row.authorId}
					</Link>
				) : (
					"—"
				),
		},
		{
			key: "thread",
			header: "主题",
			cell: (row) => (
				<Link
					href={`/admin/threads/${row.threadId}`}
					className="text-sm text-basalt-primary hover:underline"
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
