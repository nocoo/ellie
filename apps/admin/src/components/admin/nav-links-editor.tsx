"use client";

import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Badge, Button, Input, Label, LayerCard } from "@nocoo/basalt";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useCallback, useId, useMemo } from "react";
import type { NavLinkItem } from "@/viewmodels/admin/settings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NavLinkWithId extends NavLinkItem {
	id: string;
}

interface NavLinksEditorProps {
	settingKey: string;
	value: string;
	onChange: (key: string, jsonString: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseLinks(jsonString: string): NavLinkWithId[] {
	try {
		const parsed = JSON.parse(jsonString);
		if (!Array.isArray(parsed)) return [];
		return parsed.map((item: NavLinkItem, i: number) => ({
			id: `link-${i}`,
			label: item.label ?? "",
			url: item.url ?? "",
		}));
	} catch {
		return [];
	}
}

function serializeLinks(links: NavLinkWithId[]): string {
	return JSON.stringify(links.map(({ label, url }) => ({ label, url })));
}

// ---------------------------------------------------------------------------
// SortableRow
// ---------------------------------------------------------------------------

interface SortableRowProps {
	item: NavLinkWithId;
	onUpdate: (id: string, field: "label" | "url", value: string) => void;
	onDelete: (id: string) => void;
}

function SortableRow({ item, onUpdate, onDelete }: SortableRowProps) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: item.id,
	});

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	return (
		<LayerCard
			padding="none"
			ref={setNodeRef}
			style={style}
			className="grid grid-cols-[24px_minmax(0,1fr)_32px] items-center gap-2 p-3 sm:grid-cols-[24px_minmax(100px,1fr)_minmax(160px,2fr)_32px]"
		>
			<Button
				type="button"
				className="h-8 w-6 shrink-0 cursor-grab touch-none"
				{...attributes}
				{...listeners}
				variant="ghost"
				size="icon"
				aria-label="调整链接顺序"
			>
				<GripVertical className="h-4 w-4" />
			</Button>
			<div className="min-w-0 space-y-1">
				<Label htmlFor={`${item.id}-label`} className="text-[11px] text-basalt-muted-foreground">
					显示名称
				</Label>
				<Input
					id={`${item.id}-label`}
					aria-label="显示名称"
					value={item.label}
					placeholder="显示名称"
					onChange={(e) => onUpdate(item.id, "label", e.target.value)}
					className="h-8 min-w-0"
				/>
			</div>
			<div className="col-start-2 row-start-2 min-w-0 space-y-1 sm:col-start-auto sm:row-start-auto">
				<Label htmlFor={`${item.id}-url`} className="text-[11px] text-basalt-muted-foreground">
					链接地址
				</Label>
				<Input
					id={`${item.id}-url`}
					aria-label="链接地址"
					value={item.url}
					placeholder="链接地址"
					onChange={(e) => onUpdate(item.id, "url", e.target.value)}
					className="h-8 min-w-0 font-mono text-xs"
				/>
			</div>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				onClick={() => onDelete(item.id)}
				aria-label={`删除链接 ${item.label || "未命名"}`}
				className="col-start-3 row-start-1 h-8 w-8 shrink-0 text-basalt-muted-foreground hover:text-basalt-destructive sm:col-start-auto sm:row-start-auto"
			>
				<Trash2 className="h-4 w-4" />
			</Button>
		</LayerCard>
	);
}

// ---------------------------------------------------------------------------
// NavLinksEditor
// ---------------------------------------------------------------------------

export function NavLinksEditor({ settingKey, value, onChange }: NavLinksEditorProps) {
	const prefix = useId();

	const links = useMemo(() => parseLinks(value), [value]);

	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const emit = useCallback(
		(next: NavLinkWithId[]) => {
			const json = serializeLinks(next);
			if (json !== value) {
				onChange(settingKey, json);
			}
		},
		[onChange, settingKey, value],
	);

	// Re-index IDs with the instance prefix for uniqueness
	const itemsWithIds = useMemo(
		() => links.map((link, i) => ({ ...link, id: `${prefix}-${i}` })),
		[links, prefix],
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			const { active, over } = event;
			if (!over || active.id === over.id) return;

			const oldIndex = itemsWithIds.findIndex((l) => l.id === active.id);
			const newIndex = itemsWithIds.findIndex((l) => l.id === over.id);
			if (oldIndex === -1 || newIndex === -1) return;

			emit(arrayMove(itemsWithIds, oldIndex, newIndex));
		},
		[itemsWithIds, emit],
	);

	const handleUpdate = useCallback(
		(id: string, field: "label" | "url", fieldValue: string) => {
			const next = itemsWithIds.map((l) => (l.id === id ? { ...l, [field]: fieldValue } : l));
			emit(next);
		},
		[itemsWithIds, emit],
	);

	const handleDelete = useCallback(
		(id: string) => {
			emit(itemsWithIds.filter((l) => l.id !== id));
		},
		[itemsWithIds, emit],
	);

	const handleAdd = useCallback(() => {
		emit([...itemsWithIds, { id: `${prefix}-new`, label: "", url: "" }]);
	}, [itemsWithIds, emit, prefix]);

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-basalt-border pb-3">
				<p className="text-xs text-basalt-muted-foreground">
					拖动手柄排序；键盘可用空格选中、方向键移动。
				</p>
				<Badge variant="secondary">{itemsWithIds.length} 个链接</Badge>
			</div>
			{itemsWithIds.length === 0 && (
				<p className="py-6 text-center text-sm text-basalt-muted-foreground">
					尚未配置链接，点击下方添加。
				</p>
			)}
			<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
				<SortableContext items={itemsWithIds} strategy={verticalListSortingStrategy}>
					{itemsWithIds.map((item) => (
						<SortableRow
							key={item.id}
							item={item}
							onUpdate={handleUpdate}
							onDelete={handleDelete}
						/>
					))}
				</SortableContext>
			</DndContext>
			<Button type="button" variant="outline" size="sm" onClick={handleAdd}>
				<Plus className="mr-1 h-3.5 w-3.5" />
				添加链接
			</Button>
		</div>
	);
}
