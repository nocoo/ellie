import { SettingsForm } from "@/components/admin/settings-form";
import { PageHeader } from "@/components/layout/page-header";
import { fetchSettingsDetailed } from "@/viewmodels/admin/settings.server";

export default async function SettingsPage() {
	let settings = null;
	let error: string | null = null;

	try {
		settings = await fetchSettingsDetailed();
	} catch (e) {
		error = e instanceof Error ? e.message : "设置数据加载失败";
	}

	return (
		<div className="space-y-6 md:space-y-8">
			<PageHeader title="通用设置" subtitle="配置站点全局参数，更改将在保存后立即生效" />

			{error && (
				<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
					{error}
				</div>
			)}

			{settings && <SettingsForm initialSettings={settings} />}
		</div>
	);
}
