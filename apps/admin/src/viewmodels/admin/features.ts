/**
 * Feature Settings ViewModel — types, constants, and pure functions.
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

export type FeatureFieldInputType = "switch" | "number" | "checkbox-group" | "text";

export interface FeatureFieldDef {
	/** DB settings.key, e.g. "features.access.require_login" */
	key: string;
	/** Chinese display label */
	label: string;
	/** UI input control type */
	inputType: FeatureFieldInputType;
	/** Hint text below the field */
	hint?: string;
	/** For number inputs: minimum value */
	min?: number;
	/** For number inputs: suffix text (e.g., "天") */
	suffix?: string;
	/** Placeholder for number inputs */
	placeholder?: string;
}

export interface FeatureGroupDef {
	id: string;
	title: string;
	description: string;
	prefix: string;
	fields: FeatureFieldDef[];
}

// ---------------------------------------------------------------------------
// FEATURE_GROUPS — feature settings definitions
// ---------------------------------------------------------------------------

export const FEATURE_GROUPS: FeatureGroupDef[] = [
	{
		id: "access",
		title: "访问控制",
		description: "控制站点的访问权限",
		prefix: "features.access",
		fields: [
			{
				key: "features.access.require_login",
				label: "强制登录访问",
				inputType: "switch",
				hint: "开启后，所有页面都需要登录才能访问。关闭则允许匿名浏览。",
			},
			{
				key: "features.access.maintenance_mode",
				label: "站点维护模式",
				inputType: "switch",
				hint: "开启后，普通用户将看到维护页面",
			},
			{
				key: "features.access.maintenance_admin_bypass",
				label: "管理员绕过维护模式",
				inputType: "switch",
				hint: "开启后，已登录的管理员可以正常访问站点",
			},
			{
				key: "features.access.maintenance_message",
				label: "维护提示信息",
				inputType: "text",
				placeholder: "系统维护中，请稍后再试...",
				hint: "显示给用户的维护提示文字",
			},
		],
	},
	{
		id: "registration",
		title: "用户注册",
		description: "控制新用户注册功能",
		prefix: "features.registration",
		fields: [
			{
				key: "features.registration.allow_new_user",
				label: "允许新用户注册",
				inputType: "switch",
				hint: "关闭后，新用户将无法注册账号。仅管理员可手动添加用户。",
			},
		],
	},
	{
		id: "content",
		title: "内容功能",
		description: "控制用户发布内容的功能",
		prefix: "features.content",
		fields: [
			{
				key: "features.content.allow_new_thread",
				label: "允许发表新帖",
				inputType: "switch",
				hint: "关闭后用户将无法发表新主题",
			},
			{
				key: "features.content.allow_reply",
				label: "允许回复",
				inputType: "switch",
				hint: "关闭后用户将无法回复帖子",
			},
		],
	},
	{
		id: "posting",
		title: "新用户发帖限制",
		description: "限制新注册用户的发帖权限，防止垃圾内容和机器人",
		prefix: "features.posting",
		fields: [
			{
				key: "features.posting.enabled",
				label: "启用新用户限制",
				inputType: "switch",
				hint: "开启后，新用户需要满足以下条件才能发帖",
			},
			{
				key: "features.posting.min_registration_days",
				label: "最少注册天数",
				inputType: "number",
				min: 0,
				suffix: "天",
				placeholder: "1",
				hint: "用户注册满指定天数后才能发帖。设为 0 表示不限制。",
			},
			// Note: features.posting.require_email_verified is reserved for future use
			// when email verification is implemented. Currently hidden from UI.
			{
				key: "features.posting.require_avatar",
				label: "要求设置头像",
				inputType: "switch",
				hint: "用户必须上传头像后才能发帖",
			},
		],
	},
];

// ---------------------------------------------------------------------------
// Default values — used when settings don't exist
// ---------------------------------------------------------------------------

export const FEATURE_DEFAULTS: Record<string, string> = {
	// Access control - default: allow anonymous, maintenance off, admin bypass off
	"features.access.require_login": "false",
	"features.access.maintenance_mode": "false",
	"features.access.maintenance_admin_bypass": "false",
	"features.access.maintenance_message": "系统维护中，请稍后再试...",
	// Registration - default: allow new users
	"features.registration.allow_new_user": "true",
	// Content features - default: all enabled
	"features.content.allow_new_thread": "true",
	"features.content.allow_reply": "true",
	// Posting restrictions - default: enabled with basic restrictions
	"features.posting.enabled": "true",
	"features.posting.min_registration_days": "1",
	// Note: require_email_verified is reserved for future use, not exposed in UI
	"features.posting.require_avatar": "true",
};

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Convert SettingsDetailMap to flat form values (all strings for form inputs).
 * Applies defaults for missing keys.
 */
export function toFormValues(settings: SettingsDetailMap): Record<string, string> {
	const values: Record<string, string> = { ...FEATURE_DEFAULTS };
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

/**
 * Get all feature setting keys from FEATURE_GROUPS.
 */
export function getAllFeatureKeys(): string[] {
	return FEATURE_GROUPS.flatMap((group) => group.fields.map((field) => field.key));
}

// ---------------------------------------------------------------------------
// Client-side API
// ---------------------------------------------------------------------------

/**
 * Fetch feature settings via BFF proxy.
 */
export async function fetchFeatureSettings(): Promise<SettingsDetailMap> {
	const res = await apiClient.get<SettingsDetailMap>("/api/admin/settings?prefix=features.");
	return res.data;
}

/**
 * Update settings via BFF proxy (client-side only).
 */
export async function updateSettings(payload: SettingsUpdatePayload): Promise<{ updated: number }> {
	const res = await apiClient.put<{ updated: number }>("/api/admin/settings", payload);
	return res.data;
}
