"use client";

import { Badge, Button, Input, Label, LayerCard, Switch } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import type { LucideIcon } from "lucide-react";
import {
	ListOrdered,
	MessagesSquare,
	RotateCcw,
	Save,
	ShieldCheck,
	SlidersHorizontal,
	Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { twMerge as cn } from "tailwind-merge";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { AdminSaveBar } from "@/components/admin/admin-save-bar";
import {
	FEATURE_GROUPS,
	type FeatureFieldDef,
	getChangedSettings,
	type SettingsDetailMap,
	toFormValues,
	updateSettings,
} from "@/viewmodels/admin/features";

const GROUP_ICONS: Record<string, LucideIcon> = {
	access: ShieldCheck,
	registration: Users,
	content: MessagesSquare,
	posting: ListOrdered,
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FeatureSettingsFormProps {
	initialSettings: SettingsDetailMap;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FeatureSettingsForm({ initialSettings }: FeatureSettingsFormProps) {
	const router = useRouter();

	const [savedValues, setSavedValues] = useState(() => toFormValues(initialSettings));
	const [formValues, setFormValues] = useState<Record<string, string>>(savedValues);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

	const dirty = useMemo(() => {
		return Object.keys(getChangedSettings(formValues, savedValues)).length > 0;
	}, [formValues, savedValues]);

	const handleChange = useCallback((key: string, value: string) => {
		setFormValues((prev) => ({ ...prev, [key]: value }));
		setMessage(null);
	}, []);

	const handleReset = useCallback(() => {
		setFormValues(savedValues);
		setMessage(null);
	}, [savedValues]);

	const handleSave = useCallback(async () => {
		const changed = getChangedSettings(formValues, savedValues);
		if (Object.keys(changed).length === 0) return;

		setSaving(true);
		setMessage(null);

		try {
			const result = await updateSettings(changed);
			setSavedValues((previous) => ({ ...previous, ...changed }));
			setMessage({ type: "success", text: `已保存 ${result.updated} 项设置` });
			router.refresh();
		} catch (err) {
			setMessage({
				type: "error",
				text: err instanceof Error ? err.message : "保存失败",
			});
		} finally {
			setSaving(false);
		}
	}, [formValues, savedValues, router]);

	return (
		<div className="space-y-4">
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<SlidersHorizontal aria-hidden="true" className="h-5 w-5 text-basalt-primary" />
						功能设置
					</span>
				}
				description="控制站点功能开关和访问限制，更改将在保存后立即生效"
				actions={
					<>
						<Button variant="outline" size="sm" onClick={handleReset} disabled={!dirty || saving}>
							<RotateCcw className="mr-1 h-3.5 w-3.5" />
							重置
						</Button>
						<Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
							<Save className="mr-1 h-3.5 w-3.5" />
							{saving ? "保存中..." : "保存"}
						</Button>
					</>
				}
			/>

			{/* Feedback message */}
			{message && <AdminInlineMessage variant={message.type} text={message.text} />}

			{/* Feature groups */}
			<div className="grid items-start gap-4 xl:grid-cols-[200px_minmax(0,1fr)]">
				<nav aria-label="设置分组" className="flex flex-wrap gap-1 xl:sticky xl:top-0 xl:flex-col">
					{FEATURE_GROUPS.map((group) => (
						<a
							key={group.id}
							href={`#${group.id}`}
							className="rounded-md px-3 py-2 text-sm text-basalt-muted-foreground transition-colors hover:bg-basalt-accent hover:text-basalt-foreground"
						>
							{group.title}
						</a>
					))}
				</nav>
				<div className="min-w-0 space-y-4">
					{FEATURE_GROUPS.map((group) => (
						<LayerCard
							padding="none"
							key={group.id}
							id={group.id}
							className="scroll-mt-4 p-4 md:p-5"
						>
							<div className="mb-4 flex items-start justify-between gap-3 border-b border-basalt-border pb-3">
								<div>
									<h2 className="flex items-center gap-2 text-sm font-semibold">
										{(() => {
											const Icon = GROUP_ICONS[group.id];
											return <Icon aria-hidden="true" className="h-4 w-4 text-basalt-primary" />;
										})()}
										{group.title}
									</h2>
									<p className="mt-1 text-xs text-basalt-muted-foreground">{group.description}</p>
								</div>
								<Badge variant="secondary">{group.fields.length} 项</Badge>
							</div>

							<div className="grid gap-3 lg:grid-cols-2">
								{group.fields.map((field) => (
									<FeatureFieldInput
										key={field.key}
										field={field}
										value={formValues[field.key] ?? ""}
										onChange={handleChange}
										disabled={
											// Disable child fields if parent toggle is off
											group.id === "posting" &&
											field.key !== "features.posting.enabled" &&
											formValues["features.posting.enabled"] !== "true"
										}
									/>
								))}
							</div>
						</LayerCard>
					))}
				</div>
			</div>
			<AdminSaveBar dirty={dirty} saving={saving} onReset={handleReset} onSave={handleSave} />
		</div>
	);
}

// ---------------------------------------------------------------------------
// FeatureFieldInput — individual form field
// ---------------------------------------------------------------------------

interface FeatureFieldInputProps {
	field: FeatureFieldDef;
	value: string;
	onChange: (key: string, value: string) => void;
	disabled?: boolean;
}

function FeatureFieldInput({ field, value, onChange, disabled }: FeatureFieldInputProps) {
	if (field.inputType === "switch") {
		const checked = value === "true";
		return (
			<LayerCard
				padding="none"
				className={cn(
					"flex flex-row-reverse items-start gap-3 p-3 transition-colors",
					disabled && "opacity-50",
				)}
			>
				<Switch
					id={field.key}
					checked={checked}
					onCheckedChange={(newChecked) => onChange(field.key, newChecked ? "true" : "false")}
					disabled={disabled}
					className="mt-0.5"
				/>
				<div className="flex-1 space-y-1">
					<Label
						htmlFor={field.key}
						className={cn("cursor-pointer font-medium", disabled && "cursor-not-allowed")}
					>
						{field.label}
					</Label>
					{field.hint && <p className="text-xs text-basalt-muted-foreground">{field.hint}</p>}
				</div>
			</LayerCard>
		);
	}

	if (field.inputType === "number") {
		return (
			<LayerCard
				padding="none"
				className={cn(
					"flex flex-wrap items-center gap-3 p-3 transition-colors",
					disabled && "opacity-50",
				)}
			>
				<div className="flex-1 space-y-1">
					<Label htmlFor={field.key} className="font-medium">
						{field.label}
					</Label>
					{field.hint && <p className="text-xs text-basalt-muted-foreground">{field.hint}</p>}
				</div>
				<div className="flex items-center gap-2">
					<Input
						id={field.key}
						type="number"
						value={value}
						placeholder={field.placeholder}
						onChange={(e) => onChange(field.key, e.target.value)}
						min={field.min ?? 0}
						disabled={disabled}
						className="h-8 w-20 text-center"
					/>
					{field.suffix && (
						<span className="text-sm text-basalt-muted-foreground">{field.suffix}</span>
					)}
				</div>
			</LayerCard>
		);
	}

	if (field.inputType === "text") {
		return (
			<LayerCard padding="none" className={cn("p-4", disabled && "opacity-50")}>
				<div className="space-y-2">
					<Label htmlFor={field.key} className="font-medium">
						{field.label}
					</Label>
					<Input
						id={field.key}
						type="text"
						value={value}
						placeholder={field.placeholder}
						onChange={(e) => onChange(field.key, e.target.value)}
						disabled={disabled}
					/>
					{field.hint && <p className="text-xs text-basalt-muted-foreground">{field.hint}</p>}
				</div>
			</LayerCard>
		);
	}

	return null;
}
