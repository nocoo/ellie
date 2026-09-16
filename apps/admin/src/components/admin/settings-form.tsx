"use client";

import { Badge, Button, Input, Label, LayerCard, Switch } from "@nocoo/basalt";
import { InputArea } from "@nocoo/basalt/components/input-area";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import type { LucideIcon } from "lucide-react";
import {
	Globe,
	ListOrdered,
	MessagesSquare,
	RotateCcw,
	Save,
	Search,
	Settings2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { AdminSaveBar } from "@/components/admin/admin-save-bar";
import {
	getChangedSettings,
	SETTING_GROUPS,
	type SettingFieldDef,
	type SettingsDetailMap,
	toFormValues,
	updateSettings,
} from "@/viewmodels/admin/settings";

const GROUP_ICONS: Record<string, LucideIcon> = {
	"general.site": Globe,
	"general.og": MessagesSquare,
	"general.pagination": ListOrdered,
	"general.search": Search,
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SettingsFormProps {
	initialSettings: SettingsDetailMap;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsForm({ initialSettings }: SettingsFormProps) {
	const router = useRouter();

	const savedValues = useMemo(() => toFormValues(initialSettings), [initialSettings]);
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
						<Settings2 aria-hidden="true" className="h-5 w-5 text-basalt-primary" />
						通用设置
					</span>
				}
				description="配置站点全局参数，更改将在保存后立即生效"
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

			{/* Setting groups */}
			<div className="grid items-start gap-4 xl:grid-cols-[200px_minmax(0,1fr)]">
				<nav aria-label="设置分组" className="flex flex-wrap gap-1 xl:sticky xl:top-0 xl:flex-col">
					{SETTING_GROUPS.map((group) => (
						<a
							key={group.prefix}
							href={`#${group.prefix}`}
							className="rounded-md px-3 py-2 text-sm text-basalt-muted-foreground transition-colors hover:bg-basalt-accent hover:text-basalt-foreground"
						>
							{group.title}
						</a>
					))}
				</nav>
				<div className="min-w-0 space-y-4">
					{SETTING_GROUPS.map((group) => (
						<LayerCard
							padding="none"
							key={group.prefix}
							id={group.prefix}
							className="scroll-mt-4 p-4 md:p-5"
						>
							<div className="mb-4 flex items-start justify-between gap-3 border-b border-basalt-border pb-3">
								<div>
									<h2 className="flex items-center gap-2 text-sm font-semibold">
										{(() => {
											const Icon = GROUP_ICONS[group.prefix];
											return <Icon aria-hidden="true" className="h-4 w-4 text-basalt-primary" />;
										})()}
										{group.title}
									</h2>
									<p className="mt-1 text-xs text-basalt-muted-foreground">{group.description}</p>
								</div>
								<Badge variant="secondary">{group.fields.length} 项</Badge>
							</div>

							<div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
								{group.fields.map((field) => (
									<FieldInput
										key={field.key}
										field={field}
										value={formValues[field.key] ?? ""}
										onChange={handleChange}
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
// FieldInput — individual form field
// ---------------------------------------------------------------------------

interface FieldInputProps {
	field: SettingFieldDef;
	value: string;
	onChange: (key: string, value: string) => void;
}

function FieldInput({ field, value, onChange }: FieldInputProps) {
	// switch type uses checkbox
	if (field.inputType === "switch") {
		const checked = value === "true";
		return (
			<LayerCard
				padding="none"
				className="flex flex-row-reverse items-start gap-3 p-3 transition-colors sm:col-span-2"
			>
				<Switch
					id={field.key}
					checked={checked}
					onCheckedChange={(newChecked) => onChange(field.key, newChecked ? "true" : "false")}
					className="mt-0.5"
				/>
				<div className="flex-1 space-y-1">
					<Label htmlFor={field.key} className="cursor-pointer font-medium">
						{field.label}
					</Label>
					{field.hint && <p className="text-xs text-basalt-muted-foreground">{field.hint}</p>}
				</div>
			</LayerCard>
		);
	}

	// textarea gets a dedicated element
	if (field.inputType === "textarea") {
		return (
			<div className="space-y-1.5 sm:col-span-2">
				<Label htmlFor={field.key}>{field.label}</Label>
				<InputArea
					id={field.key}
					value={value}
					placeholder={field.placeholder}
					onChange={(e) => onChange(field.key, e.target.value)}
					rows={3}
				/>
				{field.hint && <p className="text-xs text-basalt-muted-foreground">{field.hint}</p>}
			</div>
		);
	}

	// Map inputType to HTML input type: number, url, or text
	const htmlType =
		field.inputType === "number" ? "number" : field.inputType === "url" ? "url" : "text";

	return (
		<div className="space-y-1.5">
			<Label htmlFor={field.key}>{field.label}</Label>
			<Input
				id={field.key}
				type={htmlType}
				value={value}
				placeholder={field.placeholder}
				onChange={(e) => onChange(field.key, e.target.value)}
				min={field.inputType === "number" ? 1 : undefined}
			/>
			{field.hint && <p className="text-xs text-basalt-muted-foreground">{field.hint}</p>}
		</div>
	);
}
