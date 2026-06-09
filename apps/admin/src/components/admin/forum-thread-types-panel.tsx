"use client";

/**
 * ForumThreadTypesPanel — 主题分类 region inside the forum edit dialog.
 *
 * Slice 2: row-level CRUD/reorder on top of the slice-1 skeleton.
 *   - Inline create form (name + displayOrder + moderatorOnly + icon)
 *     posts to the Worker `POST /forums/:id/thread-types`.
 *   - Per-row inline edit: name / displayOrder / icon / moderatorOnly,
 *     plus enable / disable toggle (separate from delete because the
 *     soft-disable semantics on the server differ).
 *   - Delete dispatches to Worker DELETE which returns either a hard
 *     delete or a soft-disable + threadCount payload — we surface both
 *     outcomes in the inline status banner.
 *   - Reorder is up/down arrow per row; the panel builds the FULL
 *     ordered id list and PATCHes /reorder (Worker requires the whole
 *     set, see #7 reviewer pin).
 *
 * Surface principles (reviewer msg 35e9af7d):
 *   - Hide Discuz `special` / `modelid` / `template` (Worker doesn't return them).
 *   - `sourceTypeid` is debug-only; never editable.
 *   - Default-collapsed; the trigger row always shows the master enable
 *     state so an admin who never opens the panel still sees whether
 *     the feature is active for this forum.
 */

import { Badge, Button, Input, Label } from "@ellie/ui";
import {
	ArrowDown,
	ArrowUp,
	ChevronDown,
	ChevronRight,
	Loader2,
	Pencil,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { extractErrorMessage } from "@/lib/admin-error";
import {
	configFlagLabel,
	createForumThreadType,
	deleteForumThreadType,
	diffConfig,
	type ForumThreadType,
	type ForumThreadTypeCreate,
	type ForumThreadTypeListResponse,
	type ForumThreadTypesConfig,
	type ForumThreadTypeUpdate,
	fetchForumThreadTypes,
	reorderForumThreadTypes,
	updateForumThreadType,
	updateForumThreadTypesConfig,
	validateConfig,
} from "@/viewmodels/admin/forum-thread-types";
import { AdminInlineMessage } from "./admin-inline-message";

export interface ForumThreadTypesPanelProps {
	/** Forum id this panel manages. `null` disables the panel (e.g. while a
	 *  new forum is being authored — types are only available after create). */
	forumId: number | null;
	/**
	 * Bumped by the parent dialog every time the forum is reopened so the
	 * panel can reset its expanded state + cached payload. Otherwise the
	 * previous forum's types would briefly flash when the dialog re-opens
	 * on a different row.
	 */
	resetKey?: number;
}

type LoadState =
	| { kind: "idle" }
	| { kind: "loading" }
	| { kind: "ready"; data: ForumThreadTypeListResponse }
	| { kind: "error"; message: string };

type PanelMessage = { variant: "success" | "error"; text: string };

export function ForumThreadTypesPanel({ forumId, resetKey = 0 }: ForumThreadTypesPanelProps) {
	const [expanded, setExpanded] = useState(false);
	const [state, setState] = useState<LoadState>({ kind: "idle" });

	// Local working copy of the 4-switch config — separated from the loaded
	// payload so flipping a switch doesn't trigger a refetch and Save can
	// compute a precise diff vs the last-known server value.
	const [configDraft, setConfigDraft] = useState<ForumThreadTypesConfig | null>(null);
	const [configSaving, setConfigSaving] = useState(false);
	const [configError, setConfigError] = useState<string | null>(null);

	// Row-level mutation feedback shared between create / update / delete /
	// reorder so the user always sees one canonical status line.
	const [rowMessage, setRowMessage] = useState<PanelMessage | null>(null);
	// id currently mutating (used to disable buttons during inflight CRUD).
	const [busyRowId, setBusyRowId] = useState<number | null>(null);
	// id currently being edited inline.
	const [editingId, setEditingId] = useState<number | null>(null);
	// Whether the inline create form is open.
	const [creating, setCreating] = useState(false);

	// Reset everything when the parent dialog navigates to a different forum.
	// biome-ignore lint/correctness/useExhaustiveDependencies: resetKey IS the trigger; body only invokes stable setters
	useEffect(() => {
		setExpanded(false);
		setState({ kind: "idle" });
		setConfigDraft(null);
		setConfigError(null);
		setRowMessage(null);
		setBusyRowId(null);
		setEditingId(null);
		setCreating(false);
	}, [resetKey]);

	const load = useCallback(async () => {
		if (!forumId) return;
		setState({ kind: "loading" });
		try {
			const data = await fetchForumThreadTypes(forumId);
			setState({ kind: "ready", data });
			setConfigDraft(data.config);
		} catch (err) {
			setState({ kind: "error", message: extractErrorMessage(err, "加载主题分类失败") });
		}
	}, [forumId]);

	// Lazy load on first expansion.
	useEffect(() => {
		if (expanded && state.kind === "idle") {
			void load();
		}
	}, [expanded, state.kind, load]);

	const handleToggle = useCallback(() => {
		setExpanded((v) => !v);
	}, []);

	const handleConfigFlagChange = useCallback((key: keyof ForumThreadTypesConfig, next: boolean) => {
		setConfigDraft((prev) => (prev ? { ...prev, [key]: next } : prev));
		setConfigError(null);
	}, []);

	const handleConfigSave = useCallback(async () => {
		if (!forumId || state.kind !== "ready" || !configDraft) return;
		const invariantError = validateConfig(configDraft);
		if (invariantError) {
			setConfigError(invariantError);
			return;
		}
		const patch = diffConfig(state.data.config, configDraft);
		if (Object.keys(patch).length === 0) {
			setConfigError("没有需要保存的更改");
			return;
		}
		setConfigSaving(true);
		setConfigError(null);
		try {
			const result = await updateForumThreadTypesConfig(forumId, patch);
			setState({ kind: "ready", data: { ...state.data, config: result.config } });
			setConfigDraft(result.config);
		} catch (err) {
			setConfigError(extractErrorMessage(err, "保存主题分类配置失败"));
		} finally {
			setConfigSaving(false);
		}
	}, [forumId, state, configDraft]);

	// ----- Row CRUD handlers -------------------------------------------------

	const replaceTypes = useCallback((mutator: (prev: ForumThreadType[]) => ForumThreadType[]) => {
		setState((prev) => {
			if (prev.kind !== "ready") return prev;
			return { kind: "ready", data: { ...prev.data, types: mutator(prev.data.types) } };
		});
	}, []);

	const handleCreate = useCallback(
		async (body: ForumThreadTypeCreate) => {
			if (!forumId) return;
			setRowMessage(null);
			try {
				const row = await createForumThreadType(forumId, body);
				replaceTypes((prev) =>
					[...prev, row].sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id),
				);
				setCreating(false);
				setRowMessage({ variant: "success", text: `已创建分类「${row.name}」` });
			} catch (err) {
				setRowMessage({ variant: "error", text: extractErrorMessage(err, "创建分类失败") });
			}
		},
		[forumId, replaceTypes],
	);

	const handleUpdate = useCallback(
		async (id: number, body: ForumThreadTypeUpdate) => {
			setRowMessage(null);
			setBusyRowId(id);
			try {
				const updated = await updateForumThreadType(id, body);
				replaceTypes((prev) =>
					prev
						.map((t) => (t.id === id ? updated : t))
						.sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id),
				);
				setEditingId(null);
				setRowMessage({ variant: "success", text: `已更新「${updated.name}」` });
			} catch (err) {
				setRowMessage({ variant: "error", text: extractErrorMessage(err, "更新分类失败") });
			} finally {
				setBusyRowId(null);
			}
		},
		[replaceTypes],
	);

	const handleDelete = useCallback(
		async (row: ForumThreadType) => {
			// One confirm dialog hop. Soft-disable case still lands on the
			// success branch — Worker returns `softDisabled:true` with a
			// `threadCount` so the user understands why the row stayed.
			const phrase = "确认删除主题分类？如有主题仍在引用，将自动停用而不是删除。\n\n继续？";
			if (!window.confirm(phrase)) return;

			setRowMessage(null);
			setBusyRowId(row.id);
			try {
				const result = await deleteForumThreadType(row.id);
				if (result.deleted) {
					replaceTypes((prev) => prev.filter((t) => t.id !== row.id));
					setRowMessage({ variant: "success", text: `已删除「${row.name}」` });
				} else {
					// Soft-disable: keep the row but flip enabled=false locally.
					replaceTypes((prev) => prev.map((t) => (t.id === row.id ? { ...t, enabled: false } : t)));
					setRowMessage({
						variant: "success",
						text: `已停用「${row.name}」（仍被 ${result.threadCount ?? 0} 个主题引用，未删除）`,
					});
				}
			} catch (err) {
				setRowMessage({ variant: "error", text: extractErrorMessage(err, "删除分类失败") });
			} finally {
				setBusyRowId(null);
			}
		},
		[replaceTypes],
	);

	const handleToggleEnabled = useCallback(
		(row: ForumThreadType) => {
			void handleUpdate(row.id, { enabled: !row.enabled });
		},
		[handleUpdate],
	);

	const handleMove = useCallback(
		async (index: number, dir: -1 | 1) => {
			if (!forumId || state.kind !== "ready") return;
			const list = state.data.types;
			const target = index + dir;
			if (target < 0 || target >= list.length) return;
			const reordered = list.slice();
			const [moved] = reordered.splice(index, 1);
			reordered.splice(target, 0, moved);
			const ids = reordered.map((t) => t.id);

			// Optimistic local move — keeps the click responsive even when
			// Worker is slow. We revert on failure by reloading.
			replaceTypes(() => reordered.map((t, i) => ({ ...t, displayOrder: i })));
			setRowMessage(null);
			setBusyRowId(moved.id);
			try {
				await reorderForumThreadTypes(forumId, ids);
				setRowMessage({ variant: "success", text: "已调整顺序" });
			} catch (err) {
				setRowMessage({ variant: "error", text: extractErrorMessage(err, "调整顺序失败") });
				void load();
			} finally {
				setBusyRowId(null);
			}
		},
		[forumId, state, replaceTypes, load],
	);

	// ----- Render ------------------------------------------------------------

	if (forumId === null) {
		return (
			<div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
				主题分类需要在版块创建后才能配置。
			</div>
		);
	}

	const masterEnabled =
		state.kind === "ready" ? state.data.config.enabled : state.kind === "loading" ? null : null;

	return (
		<div className="rounded-md border border-border">
			<button
				type="button"
				onClick={handleToggle}
				className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-medium hover:bg-accent/40"
				aria-expanded={expanded}
			>
				<span className="flex items-center gap-2">
					{expanded ? (
						<ChevronDown className="h-4 w-4 text-muted-foreground" />
					) : (
						<ChevronRight className="h-4 w-4 text-muted-foreground" />
					)}
					<span>主题分类</span>
					{state.kind === "ready" && (
						<Badge variant={masterEnabled ? "default" : "secondary"}>
							{masterEnabled ? "已启用" : "未启用"}
						</Badge>
					)}
				</span>
				{state.kind === "loading" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
			</button>

			{expanded && (
				<div className="border-t border-border px-3 py-3">
					{state.kind === "error" && (
						<AdminInlineMessage variant="error" text={state.message} dense />
					)}
					{state.kind === "loading" && (
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
							加载中...
						</div>
					)}

					{state.kind === "ready" && configDraft && (
						<ThreadTypePanelBody
							data={state.data}
							draft={configDraft}
							saving={configSaving}
							error={configError}
							onFlagChange={handleConfigFlagChange}
							onSave={handleConfigSave}
							rowMessage={rowMessage}
							editingId={editingId}
							busyRowId={busyRowId}
							creating={creating}
							onStartEdit={setEditingId}
							onCancelEdit={() => setEditingId(null)}
							onStartCreate={() => {
								setCreating(true);
								setRowMessage(null);
							}}
							onCancelCreate={() => setCreating(false)}
							onCreate={handleCreate}
							onUpdate={handleUpdate}
							onDelete={handleDelete}
							onToggleEnabled={handleToggleEnabled}
							onMove={handleMove}
						/>
					)}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Inner body (extracted to keep the wrapper readable + below complexity caps)
// ---------------------------------------------------------------------------

interface PanelBodyProps {
	data: ForumThreadTypeListResponse;
	draft: ForumThreadTypesConfig;
	saving: boolean;
	error: string | null;
	onFlagChange: (key: keyof ForumThreadTypesConfig, next: boolean) => void;
	onSave: () => void;
	rowMessage: PanelMessage | null;
	editingId: number | null;
	busyRowId: number | null;
	creating: boolean;
	onStartEdit: (id: number) => void;
	onCancelEdit: () => void;
	onStartCreate: () => void;
	onCancelCreate: () => void;
	onCreate: (body: ForumThreadTypeCreate) => void;
	onUpdate: (id: number, body: ForumThreadTypeUpdate) => void;
	onDelete: (row: ForumThreadType) => void;
	onToggleEnabled: (row: ForumThreadType) => void;
	onMove: (index: number, dir: -1 | 1) => void;
}

const CONFIG_FLAGS: (keyof ForumThreadTypesConfig)[] = [
	"enabled",
	"required",
	"listable",
	"prefix",
];

function ThreadTypePanelBody({
	data,
	draft,
	saving,
	error,
	onFlagChange,
	onSave,
	rowMessage,
	editingId,
	busyRowId,
	creating,
	onStartEdit,
	onCancelEdit,
	onStartCreate,
	onCancelCreate,
	onCreate,
	onUpdate,
	onDelete,
	onToggleEnabled,
	onMove,
}: PanelBodyProps) {
	const flagIdPrefix = useId();
	return (
		<div className="space-y-4">
			{/* 4-switch grid */}
			<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{CONFIG_FLAGS.map((key) => {
					const inputId = `${flagIdPrefix}-${key}`;
					return (
						<div
							key={key}
							className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm"
						>
							<Label htmlFor={inputId}>{configFlagLabel(key)}</Label>
							<input
								id={inputId}
								type="checkbox"
								checked={draft[key]}
								onChange={(e) => onFlagChange(key, e.target.checked)}
								disabled={saving}
								className="h-4 w-4 cursor-pointer"
							/>
						</div>
					);
				})}
			</div>

			{error && <AdminInlineMessage variant="error" text={error} dense />}

			<div className="flex items-center justify-end">
				<Button size="sm" onClick={onSave} disabled={saving}>
					{saving ? "保存中..." : "保存配置"}
				</Button>
			</div>

			{rowMessage && (
				<AdminInlineMessage variant={rowMessage.variant} text={rowMessage.text} dense />
			)}

			<ThreadTypeList
				types={data.types}
				editingId={editingId}
				busyRowId={busyRowId}
				creating={creating}
				onStartEdit={onStartEdit}
				onCancelEdit={onCancelEdit}
				onStartCreate={onStartCreate}
				onCancelCreate={onCancelCreate}
				onCreate={onCreate}
				onUpdate={onUpdate}
				onDelete={onDelete}
				onToggleEnabled={onToggleEnabled}
				onMove={onMove}
			/>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Row-level list
// ---------------------------------------------------------------------------

interface ThreadTypeListProps {
	types: ForumThreadType[];
	editingId: number | null;
	busyRowId: number | null;
	creating: boolean;
	onStartEdit: (id: number) => void;
	onCancelEdit: () => void;
	onStartCreate: () => void;
	onCancelCreate: () => void;
	onCreate: (body: ForumThreadTypeCreate) => void;
	onUpdate: (id: number, body: ForumThreadTypeUpdate) => void;
	onDelete: (row: ForumThreadType) => void;
	onToggleEnabled: (row: ForumThreadType) => void;
	onMove: (index: number, dir: -1 | 1) => void;
}

function ThreadTypeList(props: ThreadTypeListProps) {
	const {
		types,
		editingId,
		busyRowId,
		creating,
		onStartEdit,
		onCancelEdit,
		onStartCreate,
		onCancelCreate,
		onCreate,
		onUpdate,
		onDelete,
		onToggleEnabled,
		onMove,
	} = props;

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<h4 className="text-sm font-medium">分类列表</h4>
				<Button size="sm" variant="outline" onClick={onStartCreate} disabled={creating}>
					<Plus className="mr-1 h-3.5 w-3.5" /> 新建分类
				</Button>
			</div>

			{creating && <ThreadTypeCreateForm onSubmit={onCreate} onCancel={onCancelCreate} />}

			{types.length === 0 && !creating ? (
				<div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
					暂无主题分类。点击"新建分类"添加第一项。
				</div>
			) : (
				<div className="rounded-md border border-border">
					<div className="flex items-center gap-3 border-b border-border bg-secondary/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
						<div className="w-8 text-right tabular-nums">#</div>
						<div className="flex-1">名称</div>
						<div className="w-20 text-right">状态</div>
						<div className="hidden w-24 text-right sm:block">来源 typeid</div>
						<div className="w-32 text-right">操作</div>
					</div>
					{types.map((t, idx) => (
						<ThreadTypeRow
							key={t.id}
							row={t}
							index={idx}
							total={types.length}
							editing={editingId === t.id}
							busy={busyRowId === t.id}
							onStartEdit={() => onStartEdit(t.id)}
							onCancelEdit={onCancelEdit}
							onUpdate={onUpdate}
							onDelete={() => onDelete(t)}
							onToggleEnabled={() => onToggleEnabled(t)}
							onMoveUp={() => onMove(idx, -1)}
							onMoveDown={() => onMove(idx, 1)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Row + inline edit
// ---------------------------------------------------------------------------

interface ThreadTypeRowProps {
	row: ForumThreadType;
	index: number;
	total: number;
	editing: boolean;
	busy: boolean;
	onStartEdit: () => void;
	onCancelEdit: () => void;
	onUpdate: (id: number, body: ForumThreadTypeUpdate) => void;
	onDelete: () => void;
	onToggleEnabled: () => void;
	onMoveUp: () => void;
	onMoveDown: () => void;
}

function ThreadTypeRow(props: ThreadTypeRowProps) {
	const {
		row,
		index,
		total,
		editing,
		busy,
		onStartEdit,
		onCancelEdit,
		onUpdate,
		onDelete,
		onToggleEnabled,
		onMoveUp,
		onMoveDown,
	} = props;

	if (editing) {
		return (
			<div className="border-b border-border/50 px-3 py-2 last:border-b-0">
				<ThreadTypeEditForm
					row={row}
					busy={busy}
					onSubmit={(patch) => onUpdate(row.id, patch)}
					onCancel={onCancelEdit}
				/>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-3 border-b border-border/50 px-3 py-2 text-sm last:border-b-0">
			<div className="w-8 text-right tabular-nums text-xs text-muted-foreground">
				{row.displayOrder}
			</div>
			<div className="flex flex-1 items-center gap-2 min-w-0">
				<span className="truncate font-medium text-foreground">{row.name}</span>
				{row.moderatorOnly && (
					<Badge variant="outline" className="text-xs">
						仅版主
					</Badge>
				)}
			</div>
			<div className="w-20 text-right">
				<Badge variant={row.enabled ? "default" : "secondary"}>
					{row.enabled ? "启用" : "已停用"}
				</Badge>
			</div>
			<div
				className="hidden w-24 text-right text-xs text-muted-foreground tabular-nums sm:block"
				title="Discuz 本地 typeid（迁移调试用，只读）"
			>
				#{row.sourceTypeid}
			</div>
			<div className="flex w-32 items-center justify-end gap-1">
				<Button
					size="icon"
					variant="ghost"
					className="h-7 w-7"
					onClick={onMoveUp}
					disabled={busy || index === 0}
					aria-label="上移"
				>
					<ArrowUp className="h-3.5 w-3.5" />
				</Button>
				<Button
					size="icon"
					variant="ghost"
					className="h-7 w-7"
					onClick={onMoveDown}
					disabled={busy || index === total - 1}
					aria-label="下移"
				>
					<ArrowDown className="h-3.5 w-3.5" />
				</Button>
				<Button
					size="icon"
					variant="ghost"
					className="h-7 w-7"
					onClick={onStartEdit}
					disabled={busy}
					aria-label="编辑"
				>
					<Pencil className="h-3.5 w-3.5" />
				</Button>
				<Button
					size="icon"
					variant="ghost"
					className="h-7 w-7"
					onClick={onToggleEnabled}
					disabled={busy}
					aria-label={row.enabled ? "停用" : "启用"}
				>
					{row.enabled ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5 rotate-45" />}
				</Button>
				<Button
					size="icon"
					variant="ghost"
					className="h-7 w-7 text-destructive"
					onClick={onDelete}
					disabled={busy}
					aria-label="删除"
				>
					<Trash2 className="h-3.5 w-3.5" />
				</Button>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Create / edit forms
// ---------------------------------------------------------------------------

/** Pull form values from controlled state; emits empty form when no row. */
function useFormState(initial: {
	name: string;
	displayOrder: number;
	icon: string;
	moderatorOnly: boolean;
}) {
	const [name, setName] = useState(initial.name);
	const [displayOrder, setDisplayOrder] = useState(initial.displayOrder);
	const [icon, setIcon] = useState(initial.icon);
	const [moderatorOnly, setModeratorOnly] = useState(initial.moderatorOnly);
	return {
		name,
		setName,
		displayOrder,
		setDisplayOrder,
		icon,
		setIcon,
		moderatorOnly,
		setModeratorOnly,
	};
}

interface CreateFormProps {
	onSubmit: (body: ForumThreadTypeCreate) => void;
	onCancel: () => void;
}

function ThreadTypeCreateForm({ onSubmit, onCancel }: CreateFormProps) {
	const form = useFormState({ name: "", displayOrder: 0, icon: "", moderatorOnly: false });
	const canSubmit = form.name.trim().length > 0;

	return (
		<div className="rounded-md border border-border bg-muted/20 p-3">
			<FormGrid form={form} />
			<div className="mt-3 flex items-center justify-end gap-2">
				<Button size="sm" variant="ghost" onClick={onCancel}>
					取消
				</Button>
				<Button
					size="sm"
					onClick={() =>
						onSubmit({
							name: form.name.trim(),
							displayOrder: form.displayOrder,
							icon: form.icon.trim(),
							moderatorOnly: form.moderatorOnly,
						})
					}
					disabled={!canSubmit}
				>
					创建
				</Button>
			</div>
		</div>
	);
}

interface EditFormProps {
	row: ForumThreadType;
	busy: boolean;
	onSubmit: (patch: ForumThreadTypeUpdate) => void;
	onCancel: () => void;
}

function ThreadTypeEditForm({ row, busy, onSubmit, onCancel }: EditFormProps) {
	const form = useFormState({
		name: row.name,
		displayOrder: row.displayOrder,
		icon: row.icon,
		moderatorOnly: row.moderatorOnly,
	});

	// Build a patch only for fields the user actually changed — keeps the
	// Worker audit log focused on real edits.
	const patch = useMemo<ForumThreadTypeUpdate>(() => {
		const out: ForumThreadTypeUpdate = {};
		if (form.name.trim() !== row.name) out.name = form.name.trim();
		if (form.displayOrder !== row.displayOrder) out.displayOrder = form.displayOrder;
		if (form.icon.trim() !== row.icon) out.icon = form.icon.trim();
		if (form.moderatorOnly !== row.moderatorOnly) out.moderatorOnly = form.moderatorOnly;
		return out;
	}, [form.name, form.displayOrder, form.icon, form.moderatorOnly, row]);

	const dirty = Object.keys(patch).length > 0;
	const canSubmit = dirty && form.name.trim().length > 0 && !busy;

	return (
		<div>
			<FormGrid form={form} />
			<div className="mt-3 flex items-center justify-end gap-2">
				<Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
					取消
				</Button>
				<Button size="sm" onClick={() => onSubmit(patch)} disabled={!canSubmit}>
					{busy ? "保存中..." : "保存"}
				</Button>
			</div>
		</div>
	);
}

type FormState = ReturnType<typeof useFormState>;

function FormGrid({ form }: { form: FormState }) {
	const uid = useId();
	const nameId = `${uid}-name`;
	const orderId = `${uid}-order`;
	const iconId = `${uid}-icon`;
	const modId = `${uid}-mod`;
	return (
		<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
			<div className="grid gap-1 text-xs">
				<Label htmlFor={nameId} className="text-muted-foreground">
					名称
				</Label>
				<Input
					id={nameId}
					value={form.name}
					onChange={(e) => form.setName(e.target.value)}
					maxLength={100}
					placeholder="分类名"
				/>
			</div>
			<div className="grid gap-1 text-xs">
				<Label htmlFor={orderId} className="text-muted-foreground">
					排序
				</Label>
				<Input
					id={orderId}
					type="number"
					value={form.displayOrder}
					onChange={(e) => form.setDisplayOrder(Number(e.target.value) || 0)}
					min={0}
				/>
			</div>
			<div className="grid gap-1 text-xs sm:col-span-2">
				<Label htmlFor={iconId} className="text-muted-foreground">
					图标 (URL 或 emoji，可空)
				</Label>
				<Input
					id={iconId}
					value={form.icon}
					onChange={(e) => form.setIcon(e.target.value)}
					maxLength={200}
					placeholder=""
				/>
			</div>
			<div className="flex items-center gap-2 text-xs sm:col-span-2">
				<input
					id={modId}
					type="checkbox"
					checked={form.moderatorOnly}
					onChange={(e) => form.setModeratorOnly(e.target.checked)}
					className="h-4 w-4 cursor-pointer"
				/>
				<Label htmlFor={modId}>仅版主可选 (moderatorOnly)</Label>
			</div>
		</div>
	);
}
