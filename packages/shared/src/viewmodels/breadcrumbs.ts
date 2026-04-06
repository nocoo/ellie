// viewmodels/shared/breadcrumbs.ts — Shared BreadcrumbItem type definition
// Single source of truth for the BreadcrumbItem interface used across
// viewmodels, components, and lib layers.

/**
 * Represents a single breadcrumb navigation item.
 * If `href` is provided, the item renders as a link; otherwise as plain text.
 */
export interface BreadcrumbItem {
	label: string;
	href?: string;
	/** Render a Home icon instead of the label text */
	icon?: "home";
}
