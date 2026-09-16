"use client";

import { Button, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { Link2, RotateCcw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { AdminSaveBar } from "@/components/admin/admin-save-bar";
import { updateSettings } from "@/viewmodels/admin/settings";
import { NavLinksEditor } from "./nav-links-editor";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LinkListSettingsProps {
	/** Page heading */
	title: string;
	/** Page description */
	description: string;
	/** DB settings key, e.g. "general.navigation.header_links" */
	settingKey: string;
	/** Initial JSON string from server (fetched via fetchSettingsDetailed) */
	initialValue: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LinkListSettings({
	title,
	description,
	settingKey,
	initialValue,
}: LinkListSettingsProps) {
	const router = useRouter();

	const [savedValue, setSavedValue] = useState(initialValue);
	const [currentValue, setCurrentValue] = useState(initialValue);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

	const dirty = currentValue !== savedValue;

	const handleChange = useCallback((_key: string, jsonString: string) => {
		setCurrentValue(jsonString);
		setMessage(null);
	}, []);

	const handleReset = useCallback(() => {
		setCurrentValue(savedValue);
		setMessage(null);
	}, [savedValue]);

	const handleSave = useCallback(async () => {
		if (!dirty) return;

		setSaving(true);
		setMessage(null);

		try {
			const result = await updateSettings({ [settingKey]: currentValue });
			setMessage({ type: "success", text: `已保存 ${result.updated} 项设置` });
			setSavedValue(currentValue);
			router.refresh();
		} catch (err) {
			setMessage({
				type: "error",
				text: err instanceof Error ? err.message : "保存失败",
			});
		} finally {
			setSaving(false);
		}
	}, [dirty, settingKey, currentValue, router]);

	return (
		<div className="space-y-4">
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						<Link2 aria-hidden="true" className="h-5 w-5 text-basalt-primary" />
						{title}
					</span>
				}
				description={description}
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

			{/* Link editor card */}
			<LayerCard padding="none" className="p-4">
				<NavLinksEditor settingKey={settingKey} value={currentValue} onChange={handleChange} />
			</LayerCard>
			<AdminSaveBar dirty={dirty} saving={saving} onReset={handleReset} onSave={handleSave} />
		</div>
	);
}
