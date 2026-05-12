// Shared option lists for profile fields used by both registration and profile-edit.
//
// These are presentation-layer choice lists; the underlying backend payload still
// stores them as strings in the existing fields (`graduateSchool`, `campus`).
// Keeping them in one place prevents the registration form and the profile-edit
// dialog from drifting apart.

export interface ProfileSelectOption {
	value: string;
	label: string;
}

/**
 * Identity-type options stored in the `graduateSchool` field.
 *
 * Despite the historical field name, this is used as the user's identity-type
 * dropdown (校内人士 / 已毕业校友 / 校外人士) rather than a free-text school name.
 */
export const IDENTITY_OPTIONS: ProfileSelectOption[] = [
	{ value: "", label: "请选择" },
	{ value: "校内人士", label: "校内人士" },
	{ value: "已毕业校友", label: "已毕业校友" },
	{ value: "校外人士", label: "校外人士" },
];

/**
 * Campus options.
 *
 * 4 official Tongji campuses (四平路/嘉定/沪西/沪北) + 2 historical/identity compat values
 * (其他校区, 校外人士).
 */
export const CAMPUS_OPTIONS: ProfileSelectOption[] = [
	{ value: "", label: "请选择校区" },
	{ value: "四平路校区", label: "四平路校区" },
	{ value: "嘉定校区", label: "嘉定校区" },
	{ value: "沪西校区", label: "沪西校区" },
	{ value: "沪北校区", label: "沪北校区" },
	{ value: "其他校区", label: "其他校区" },
	{ value: "校外人士", label: "校外人士" },
];
