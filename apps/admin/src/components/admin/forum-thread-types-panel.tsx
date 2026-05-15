"use client";

/**
 * ForumThreadTypesPanel — 主题分类 region inside the forum edit dialog.
 *
 * Slice 1 (this commit): structural skeleton.
 *   - Lazily fetches the admin list payload when first expanded.
 *   - 4-switch config (enabled / required / listable / prefix) wired with
 *     save-on-change + Worker invariant pre-check (`required ⇒ enabled`).
 *   - Per-row list rendered READ-ONLY for now — name, displayOrder,
 *     enabled badge, moderatorOnly badge, sourceTypeid debug pill. CRUD
 *     buttons / reorder / create dialog are intentionally NOT here; they
 *     land in slice 2 to keep this commit reviewable.
 *
 * Surface principles (reviewer msg 35e9af7d):
 *   - Hide Discuz `special` / `modelid` / `template` fields entirely
 *     (Worker doesn't return them; nothing to suppress here).
 *   - `sourceTypeid` is debug-only; render it muted + clearly labelled.
 *   - Default-collapsed; the trigger row always shows the master enable
 *     state so an admin who never opens the panel still sees whether
 *     the feature is active for this forum.
 */

import { extractErrorMessage } from "@/lib/admin-error";
import {
	type ForumThreadType,
	type ForumThreadTypeListResponse,
	type ForumThreadTypesConfig,
	configFlagLabel,
	diffConfig,
	fetchForumThreadTypes,
	updateForumThreadTypesConfig,
	validateConfig,
} from "@/viewmodels/admin/forum-thread-types";
import { Badge, Button } from "@ellie/ui";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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

export function ForumThreadTypesPanel({ forumId, resetKey = 0 }: ForumThreadTypesPanelProps) {
	const [expanded, setExpanded] = useState(false);
	const [state, setState] = useState<LoadState>({ kind: "idle" });

	// Local working copy of the 4-switch config — separated from the loaded
	// payload so flipping a switch doesn't trigger a refetch and Save can
	// compute a precise diff vs the last-known server value.
	const [configDraft, setConfigDraft] = useState<ForumThreadTypesConfig | null>(null);
	const [configSaving, setConfigSaving] = useState(false);
	const [configError, setConfigError] = useState<string | null>(null);

	// Reset everything when the parent dialog navigates to a different forum.
	// biome-ignore lint/correctness/useExhaustiveDependencies: resetKey IS the trigger; body only invokes stable setters
	useEffect(() => {
		setExpanded(false);
		setState({ kind: "idle" });
		setConfigDraft(null);
		setConfigError(null);
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

	// When forumId is null (e.g. inside a create dialog before the row
	// exists), render a disabled placeholder so the location is discoverable.
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
}

const CONFIG_FLAGS: (keyof ForumThreadTypesConfig)[] = [
	"enabled",
	"required",
	"listable",
	"prefix",
];

function ThreadTypePanelBody({ data, draft, saving, error, onFlagChange, onSave }: PanelBodyProps) {
	return (
		<div className="space-y-4">
			{/* 4-switch grid */}
			<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{CONFIG_FLAGS.map((key) => (
					<label
						key={key}
						className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm"
					>
						<span>{configFlagLabel(key)}</span>
						<input
							type="checkbox"
							checked={draft[key]}
							onChange={(e) => onFlagChange(key, e.target.checked)}
							disabled={saving}
							className="h-4 w-4 cursor-pointer"
						/>
					</label>
				))}
			</div>

			{error && <AdminInlineMessage variant="error" text={error} dense />}

			<div className="flex items-center justify-end">
				<Button size="sm" onClick={onSave} disabled={saving}>
					{saving ? "保存中..." : "保存配置"}
				</Button>
			</div>

			{/* Read-only type list. Row-level CRUD lands in slice 2. */}
			<ThreadTypeListSkeleton types={data.types} />
		</div>
	);
}

function ThreadTypeListSkeleton({ types }: { types: ForumThreadType[] }) {
	if (types.length === 0) {
		return (
			<div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
				暂无主题分类。创建、排序与删除等操作将在下一阶段开放。
			</div>
		);
	}
	return (
		<div className="rounded-md border border-border">
			<div className="flex items-center gap-3 border-b border-border bg-secondary/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
				<div className="w-8 text-right tabular-nums">#</div>
				<div className="flex-1">名称</div>
				<div className="w-20 text-right">状态</div>
				<div className="hidden w-32 text-right sm:block">来源 typeid</div>
			</div>
			{types.map((t) => (
				<div
					key={t.id}
					className="flex items-center gap-3 border-b border-border/50 px-3 py-2 text-sm last:border-b-0"
				>
					<div className="w-8 text-right tabular-nums text-xs text-muted-foreground">
						{t.displayOrder}
					</div>
					<div className="flex flex-1 items-center gap-2 min-w-0">
						<span className="truncate font-medium text-foreground">{t.name}</span>
						{t.moderatorOnly && (
							<Badge variant="outline" className="text-xs">
								仅版主
							</Badge>
						)}
					</div>
					<div className="w-20 text-right">
						<Badge variant={t.enabled ? "default" : "secondary"}>
							{t.enabled ? "启用" : "已停用"}
						</Badge>
					</div>
					<div
						className="hidden w-32 text-right text-xs text-muted-foreground tabular-nums sm:block"
						title="Discuz 本地 typeid（迁移调试用，只读）"
					>
						#{t.sourceTypeid}
					</div>
				</div>
			))}
		</div>
	);
}
