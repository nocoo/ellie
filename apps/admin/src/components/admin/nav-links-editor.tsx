"use client";

import type { NavLinkItem } from "@/viewmodels/admin/settings";
import {
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	arrayMove,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@ellie/ui";
import { Input } from "@ellie/ui";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useCallback, useId, useMemo, useRef } from "react";

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
		<div
			ref={setNodeRef}
			style={style}
			className="flex items-center gap-2 rounded-lg bg-secondary p-2"
		>
			<button
				type="button"
				className="flex shrink-0 cursor-grab touch-none items-center text-muted-foreground hover:text-foreground"
				{...attributes}
				{...listeners}
			>
				<GripVertical className="h-4 w-4" />
			</button>
			<Input
				value={item.label}
				placeholder="显示名称"
				onChange={(e) => onUpdate(item.id, "label", e.target.value)}
				className="flex-1"
			/>
			<Input
				value={item.url}
				placeholder="链接地址"
				onChange={(e) => onUpdate(item.id, "url", e.target.value)}
				className="flex-1"
			/>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				onClick={() => onDelete(item.id)}
				className="shrink-0 text-muted-foreground hover:text-destructive"
			>
				<Trash2 className="h-4 w-4" />
			</Button>
		</div>
	);
}

// ---------------------------------------------------------------------------
// NavLinksEditor
// ---------------------------------------------------------------------------

export function NavLinksEditor({ settingKey, value, onChange }: NavLinksEditorProps) {
	const prefix = useId();
	const lastEmittedRef = useRef(value);

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
			if (json !== lastEmittedRef.current) {
				lastEmittedRef.current = json;
				onChange(settingKey, json);
			}
		},
		[onChange, settingKey],
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
		<div className="mt-4 space-y-2">
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
