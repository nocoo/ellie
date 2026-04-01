// components/forum/new-thread-form.tsx — Discuz-style "发表帖子" page layout
// Layout only — submit actions are placeholder (功能暂缓).
// Reuses the existing Tiptap PostEditor for the rich-text area.

"use client";

import { PostEditor } from "@/components/forum/post-editor";
import { type BreadcrumbItem, Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
	EDITOR_TOOL_ACTIONS,
	EXTRA_OPTIONS,
	GROUP_OPTIONS,
	POST_TYPE_TABS,
	SUBJECT_MAX_LENGTH,
} from "@/viewmodels/forum/new-thread";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NewThreadFormProps {
	breadcrumbs: BreadcrumbItem[];
	forumId: number;
}

// ---------------------------------------------------------------------------
// Layer 1: Post type tabs (发表帖子 | 发起投票 | ...)
// ---------------------------------------------------------------------------

function PostTypeTabs({
	activeTab,
	onTabChange,
}: {
	activeTab: string;
	onTabChange: (v: string) => void;
}) {
	return (
		<div className="flex items-end border-b border-border">
			{POST_TYPE_TABS.map((tab) => {
				const isActive = tab.value === activeTab;
				return (
					<button
						key={tab.value}
						type="button"
						onClick={() => onTabChange(tab.value)}
						className={cn(
							"px-4 py-2 text-sm font-medium transition-colors border border-border -mb-px",
							isActive
								? "bg-card text-foreground border-b-card"
								: "bg-muted text-muted-foreground hover:text-foreground border-b-border",
						)}
					>
						{tab.label}
					</button>
				);
			})}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Layer 2: Subject input with char counter
// ---------------------------------------------------------------------------

function SubjectInput({
	value,
	onChange,
}: {
	value: string;
	onChange: (v: string) => void;
}) {
	const remaining = SUBJECT_MAX_LENGTH - value.length;

	return (
		<div className="flex items-center gap-3 py-3">
			<Input
				value={value}
				onChange={(e) => onChange(e.target.value.slice(0, SUBJECT_MAX_LENGTH))}
				placeholder=""
				className="h-[34px] flex-1 rounded border border-input text-sm"
			/>
			<span className="whitespace-nowrap text-sm text-muted-foreground">
				还可输入 <span className="font-bold text-foreground">{remaining}</span> 个字符
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Layer 3: Editor toolbar actions (auto-save / word count / resize)
// ---------------------------------------------------------------------------

function EditorToolbar() {
	return (
		<div className="flex items-center justify-end gap-0 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
			{EDITOR_TOOL_ACTIONS.map((action, i) => (
				<span key={action.label} className="flex items-center">
					{/* Separator: use | between groups, space within */}
					{i > 0 && i !== 2 && i !== 4 && <span className="mx-1"> </span>}
					{(i === 2 || i === 4) && <span className="mx-1.5 text-border">|</span>}
					{action.isAction ? (
						<button
							type="button"
							className="text-muted-foreground hover:text-primary transition-colors"
						>
							{action.label}
						</button>
					) : (
						<span className="text-forum-accent">{action.label}</span>
					)}
				</span>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Layer 4: Extra options row (radio-style toggles)
// ---------------------------------------------------------------------------

function ExtraOptionsRow() {
	return (
		<div className="flex items-center gap-4 border border-border rounded-sm bg-card px-4 py-2.5">
			{EXTRA_OPTIONS.map((opt) => (
				<label
					key={opt.value}
					htmlFor={`extra-opt-${opt.value}`}
					className="flex items-center gap-1.5 text-sm text-foreground cursor-pointer"
				>
					<input
						id={`extra-opt-${opt.value}`}
						type="radio"
						name="extra-option"
						value={opt.value}
						className="sr-only"
					/>
					<span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-card">
						<span className="h-1.5 w-1.5 rounded-full" />
					</span>
					{opt.label}
				</label>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Layer 5: Submit row (buttons + group selector + 本版积分规则)
// ---------------------------------------------------------------------------

function SubmitRow() {
	return (
		<div className="flex items-center justify-between">
			<div className="flex items-center gap-2">
				<Button size="default" className="px-4 text-sm">
					发表帖子
				</Button>
				<Button variant="outline" size="default" className="px-4 text-sm">
					保存草稿
				</Button>

				<span className="ml-2 text-sm text-muted-foreground">来自群组：</span>
				<select className="h-[30px] rounded border border-input bg-card px-2 text-sm text-muted-foreground outline-none">
					{GROUP_OPTIONS.map((g) => (
						<option key={g.value} value={g.value}>
							{g.label}
						</option>
					))}
				</select>
			</div>

			<button
				type="button"
				className="text-sm text-muted-foreground hover:text-primary transition-colors"
			>
				本版积分规则
			</button>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main export: NewThreadForm
// ---------------------------------------------------------------------------

export function NewThreadForm({ breadcrumbs, forumId: _forumId }: NewThreadFormProps) {
	const [activeTab, setActiveTab] = useState("thread");
	const [subject, setSubject] = useState("");

	return (
		<div className="space-y-3">
			{/* Breadcrumbs */}
			{breadcrumbs.length > 1 && (
				<div className="py-2">
					<Breadcrumbs items={breadcrumbs} />
				</div>
			)}

			{/* Post type tabs */}
			<PostTypeTabs activeTab={activeTab} onTabChange={setActiveTab} />

			{/* Subject input */}
			<SubjectInput value={subject} onChange={setSubject} />

			{/* Rich text editor (reuse existing Tiptap PostEditor) */}
			<PostEditor
				initialContent=""
				onSubmit={() => {}}
				placeholder="输入帖子内容..."
				subject={undefined}
				canSubmit={false}
			/>

			{/* Auto-save / tool actions bar */}
			<EditorToolbar />

			{/* Extra options */}
			<ExtraOptionsRow />

			{/* Submit row */}
			<SubmitRow />
		</div>
	);
}
