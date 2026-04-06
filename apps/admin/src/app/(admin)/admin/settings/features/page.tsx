import { FeatureSettingsForm } from "@/components/admin/feature-settings-form";
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
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-semibold text-foreground">功能设置</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					控制站点功能开关和访问限制，更改将在保存后立即生效
				</p>
			</div>

			{error && (
				<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
					{error}
				</div>
			)}

			{settings && <FeatureSettingsForm initialSettings={settings} />}
		</div>
	);
}
