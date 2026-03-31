"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	type SettingFieldDef,
	type SettingsDetailMap,
	SETTING_GROUPS,
	getChangedSettings,
	toFormValues,
	updateSettings,
} from "@/viewmodels/admin/settings";
import { RotateCcw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

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
		<div className="space-y-6">
			{/* Action bar */}
			<div className="flex items-center justify-end gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={handleReset}
					disabled={!dirty || saving}
				>
					<RotateCcw className="mr-1 h-3.5 w-3.5" />
					重置
				</Button>
				<Button
					size="sm"
					onClick={handleSave}
					disabled={!dirty || saving}
				>
					<Save className="mr-1 h-3.5 w-3.5" />
					{saving ? "保存中..." : "保存"}
				</Button>
			</div>

			{/* Feedback message */}
			{message && (
				<div
					className={`rounded-lg border p-3 text-sm ${
						message.type === "success"
							? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
							: "border-destructive/50 bg-destructive/10 text-destructive"
					}`}
				>
					{message.text}
				</div>
			)}

			{/* Setting groups */}
			{SETTING_GROUPS.map((group) => (
				<div key={group.prefix} className="rounded-xl border bg-card p-6">
					<h2 className="text-base font-semibold text-foreground">{group.title}</h2>
					<p className="mt-1 text-sm text-muted-foreground">{group.description}</p>

					<div className="mt-4 grid gap-4 sm:grid-cols-2">
						{group.fields.map((field) => (
							<FieldInput
								key={field.key}
								field={field}
								value={formValues[field.key] ?? ""}
								onChange={handleChange}
							/>
						))}
					</div>
				</div>
			))}
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
	// textarea gets a dedicated element
	if (field.inputType === "textarea") {
		return (
			<div className="space-y-1.5 sm:col-span-2">
				<Label htmlFor={field.key}>{field.label}</Label>
				<textarea
					id={field.key}
					value={value}
					placeholder={field.placeholder}
					onChange={(e) => onChange(field.key, e.target.value)}
					rows={3}
					className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
				/>
				{field.hint && (
					<p className="text-xs text-muted-foreground">{field.hint}</p>
				)}
			</div>
		);
	}

	// Map inputType to HTML input type: number, url, or text
	const htmlType = field.inputType === "number" ? "number" : field.inputType === "url" ? "url" : "text";

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
			{field.hint && (
				<p className="text-xs text-muted-foreground">{field.hint}</p>
			)}
		</div>
	);
}
