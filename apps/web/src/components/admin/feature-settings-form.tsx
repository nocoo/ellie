"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
	FEATURE_GROUPS,
	type FeatureFieldDef,
	type SettingsDetailMap,
	getChangedSettings,
	toFormValues,
	updateSettings,
} from "@/viewmodels/admin/features";
import { RotateCcw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Button } from "../ui/button";

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
				<Button variant="outline" size="sm" onClick={handleReset} disabled={!dirty || saving}>
					<RotateCcw className="mr-1 h-3.5 w-3.5" />
					重置
				</Button>
				<Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
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

			{/* Feature groups */}
			{FEATURE_GROUPS.map((group) => (
				<div key={group.id} className="rounded-xl border bg-card p-6">
					<h2 className="text-base font-semibold text-foreground">{group.title}</h2>
					<p className="mt-1 text-sm text-muted-foreground">{group.description}</p>

					<div className="mt-4 space-y-4">
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
				</div>
			))}
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
			<div
				className={cn(
					"flex items-start gap-3 rounded-lg border p-4 transition-colors",
					disabled && "opacity-50",
				)}
			>
				<Checkbox
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
					{field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
				</div>
			</div>
		);
	}

	if (field.inputType === "number") {
		return (
			<div
				className={cn(
					"flex items-center gap-4 rounded-lg border p-4 transition-colors",
					disabled && "opacity-50",
				)}
			>
				<div className="flex-1 space-y-1">
					<Label htmlFor={field.key} className="font-medium">
						{field.label}
					</Label>
					{field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
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
						className="w-20 text-center"
					/>
					{field.suffix && <span className="text-sm text-muted-foreground">{field.suffix}</span>}
				</div>
			</div>
		);
	}

	if (field.inputType === "text") {
		return (
			<div className={cn("rounded-lg border p-4", disabled && "opacity-50")}>
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
					{field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
				</div>
			</div>
		);
	}

	return null;
}
