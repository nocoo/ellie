import { FeatureSettingsForm } from "@/components/admin/feature-settings-form";
import { PageHeader } from "@/components/layout/page-header";
import { fetchSettingsDetailed } from "@/viewmodels/admin/settings.server";

export default async function FeatureSettingsPage() {
	let settings = null;
	let error: string | null = null;

	try {
		// Fetch all settings (we'll filter by prefix in the form)
		settings = await fetchSettingsDetailed("features.");
	} catch (e) {
		error = e instanceof Error ? e.message : "设置数据加载失败";
	}

	return (
		<div className="space-y-6 md:space-y-8">
			<PageHeader title="功能设置" subtitle="控制站点功能开关和访问限制，更改将在保存后立即生效" />

			{error && (
				<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
					{error}
				</div>
			)}

			{settings && <FeatureSettingsForm initialSettings={settings} />}
		</div>
	);
}
