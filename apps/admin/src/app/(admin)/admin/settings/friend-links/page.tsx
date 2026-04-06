import { LinkListSettings } from "@/components/admin/link-list-settings";
import { fetchSettingsDetailed } from "@/viewmodels/admin/settings.server";

export default async function FriendLinksPage() {
	let initialValue = "[]";
	let error: string | null = null;

	try {
		const settings = await fetchSettingsDetailed();
		initialValue = settings["general.navigation.friend_links"]?.value ?? "[]";
	} catch (e) {
		error = e instanceof Error ? e.message : "设置数据加载失败";
	}

	return error ? (
		<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
			{error}
		</div>
	) : (
		<LinkListSettings
			title="友情链接"
			description="配置首页底部友情链接，拖拽调整顺序"
			settingKey="general.navigation.friend_links"
			initialValue={initialValue}
		/>
	);
}
