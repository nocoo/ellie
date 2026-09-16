import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { LinkListSettings } from "@/components/admin/link-list-settings";
import { fetchSettingsDetailed } from "@/viewmodels/admin/settings.server";

export default async function NavLinksPage() {
	let initialValue = "[]";
	let error: string | null = null;

	try {
		const settings = await fetchSettingsDetailed();
		initialValue = settings["general.navigation.header_links"]?.value ?? "[]";
	} catch (e) {
		error = e instanceof Error ? e.message : "设置数据加载失败";
	}

	return error ? (
		<AdminInlineMessage variant="error" text={error} />
	) : (
		<LinkListSettings
			title="顶部导航"
			description="配置首页顶部快捷导航栏目，拖拽调整顺序"
			settingKey="general.navigation.header_links"
			initialValue={initialValue}
		/>
	);
}
