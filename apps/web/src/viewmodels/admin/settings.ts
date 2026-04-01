/**
 * Settings ViewModel — types, constants, and pure functions.
 * Client-safe — no server-only imports.
 */

import { apiClient } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SettingEntry {
	value: string;
	type: "string" | "number" | "boolean" | "json";
	updatedAt: number;
}

export type SettingsDetailMap = Record<string, SettingEntry>;
export type SettingsUpdatePayload = Record<string, string>;

// ---------------------------------------------------------------------------
// Field definition types
// ---------------------------------------------------------------------------

export interface SettingFieldDef {
	/** DB settings.key, e.g. "general.site.name" */
	key: string;
	/** Chinese display label */
	label: string;
	placeholder?: string;
	/** UI input control type (independent from DB type column) */
	inputType?: "text" | "number" | "url" | "textarea";
	/** Hint text below the field */
	hint?: string;
}

export interface SettingGroupDef {
	title: string;
	description: string;
	prefix: string;
	fields: SettingFieldDef[];
}

/** A single navigation link item stored in the header_links JSON array */
export interface NavLinkItem {
	label: string;
	url: string;
}

// ---------------------------------------------------------------------------
// SETTING_GROUPS — 4 groups of form field definitions
// ---------------------------------------------------------------------------

export const SETTING_GROUPS: SettingGroupDef[] = [
	{
		title: "站点品牌",
		description: "配置站点名称、版权信息等基本标识",
		prefix: "general.site",
		fields: [
			{ key: "general.site.name", label: "站点名称", placeholder: "Ellie" },
			{ key: "general.site.subtitle", label: "站点描述", placeholder: "Ellie admin console" },
			{ key: "general.site.copyright", label: "版权持有者", placeholder: "同济网" },
			{ key: "general.site.powered_by", label: "页脚署名", placeholder: "Powered by Ellie" },
			{ key: "general.site.version", label: "版本号", placeholder: "v0.1" },
		],
	},
	{
		title: "OG 社交媒体元数据",
		description: "配置 Open Graph 和 Twitter Card 标签",
		prefix: "general.og",
		fields: [
			{ key: "general.og.title", label: "og:title", placeholder: "站点标题" },
			{ key: "general.og.description", label: "og:description", placeholder: "站点描述" },
			{ key: "general.og.site_name", label: "og:site_name", placeholder: "站点名称" },
			{
				key: "general.og.image",
				label: "og:image",
				inputType: "url",
				placeholder: "https://example.com/og.png",
			},
			{
				key: "general.og.url",
				label: "og:url",
				inputType: "url",
				placeholder: "https://example.com",
			},
			{
				key: "general.og.twitter_card",
				label: "twitter:card",
				placeholder: "summary",
				hint: "summary / summary_large_image",
			},
			{ key: "general.og.twitter_site", label: "twitter:site", placeholder: "@handle" },
		],
	},
	{
		title: "分页与限制",
		description: "配置列表分页大小和内容长度限制",
		prefix: "general.pagination",
		fields: [
			{
				key: "general.pagination.threads_per_page",
				label: "版块主题每页数",
				inputType: "number",
				placeholder: "100",
			},
			{
				key: "general.pagination.posts_per_page",
				label: "帖子回帖每页数",
				inputType: "number",
				placeholder: "20",
			},
			{
				key: "general.pagination.user_history_per_page",
				label: "用户历史每页数",
				inputType: "number",
				placeholder: "20",
			},
			{
				key: "general.pagination.max_post_length",
				label: "帖子最大字数",
				inputType: "number",
				placeholder: "50000",
			},
			{
				key: "general.pagination.admin_page_size",
				label: "管理列表每页数",
				inputType: "number",
				placeholder: "20",
			},
		],
	},
	{
		title: "资源配置",
		description: "配置 CDN 地址和外部资源路径",
		prefix: "general.assets",
		fields: [
			{
				key: "general.assets.avatar_cdn_base",
				label: "头像 CDN 基础 URL",
				inputType: "url",
				placeholder: "https://t.no.mt/avatar",
				hint: "不含尾部斜杠",
			},
		],
	},
];

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Convert SettingsDetailMap to flat form values (all strings for form inputs).
 */
export function toFormValues(settings: SettingsDetailMap): Record<string, string> {
	const values: Record<string, string> = {};
	for (const [key, entry] of Object.entries(settings)) {
		values[key] = entry.value;
	}
	return values;
}

/**
 * Compute diff between current form values and saved values.
 * Returns only changed key-value pairs.
 */
export function getChangedSettings(
	current: Record<string, string>,
	saved: Record<string, string>,
): SettingsUpdatePayload {
	const changed: SettingsUpdatePayload = {};
	for (const [key, value] of Object.entries(current)) {
		if (value !== saved[key]) {
			changed[key] = value;
		}
	}
	return changed;
}

// ---------------------------------------------------------------------------
// Client-side API
// ---------------------------------------------------------------------------

/**
 * Update settings via BFF proxy (client-side only).
 */
export async function updateSettings(payload: SettingsUpdatePayload): Promise<{ updated: number }> {
	const res = await apiClient.put<{ updated: number }>("/api/admin/settings", payload);
	return res.data;
}
