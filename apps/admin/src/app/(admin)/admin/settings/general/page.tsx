import { PageHeader } from "@nocoo/basalt/components/page-header";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { SettingsForm } from "@/components/admin/settings-form";
import { fetchSettingsDetailed } from "@/viewmodels/admin/settings.server";

export default async function SettingsPage() {
	let settings = null;
	let error: string | null = null;

	try {
		settings = await fetchSettingsDetailed();
	} catch (e) {
		error = e instanceof Error ? e.message : "设置数据加载失败";
	}

	if (settings) return <SettingsForm initialSettings={settings} />;

	return (
		<div className="space-y-6 md:space-y-8">
			<PageHeader title="通用设置" description="配置站点全局参数，更改将在保存后立即生效" />

			{error && <AdminInlineMessage variant="error" text={error} />}
		</div>
	);
}
