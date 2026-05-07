// legacy-discuz-stubs.ts — Compatibility stubs for legacy Discuz inline handlers.
//
// Old forum HTML (millions of historical rows) embeds inline handlers that
// reference functions which only existed in the old Discuz frontend bundle:
//
//   <img onload="thumbImg(this)">
//   <img onload="attachimg(this, 'load')">
//   <img onmouseover="img_onmouseoverfunc(this)">
//
// In the new ellie web app these throw `Uncaught ReferenceError` on every
// thread/forum render. The DOMPurify pipeline in `content-filter.ts` strips
// these on the post-display path, but other surfaces (search snippets,
// cached signatures, server-rendered fields written before sanitization)
// can still bypass it. Rewriting the dataset is impractical given the
// volume, so we install no-op stubs on `window` instead.
//
// Constraints:
//   - Stubs must be available BEFORE any post HTML hydrates, otherwise the
//     `onload` fires synchronously on cached images and races React. Hence
//     the inline-script form, intended for the document `<head>`.
//   - Pure no-op: original Discuz behavior was thumbnail resize / hover
//     preview. zheng-li approved "先保证不报错，再看是否需要保持旧行为".
//   - Server-only modules MUST NOT install these — `globalThis` on a
//     Cloudflare Worker is shared across requests, so we touch `window`
//     only via the inline script (browser-only) and the explicit
//     `installLegacyDiscuzStubs` test entry point.
//   - Already-defined functions (e.g. someone replaces a stub later with a
//     real impl) are preserved — we never overwrite.

/**
 * Subset of `Window` (plus an index signature) that we treat as a stub
 * install target. Kept loose so callers in tests can hand in a plain
 * object instead of a real `Window`.
 */
export interface LegacyDiscuzStubTarget {
	thumbImg?: unknown;
	attachimg?: unknown;
	img_onmouseoverfunc?: unknown;
	[key: string]: unknown;
}

/** The list of legacy Discuz globals we stub — single source of truth. */
export const LEGACY_DISCUZ_STUB_NAMES = ["thumbImg", "attachimg", "img_onmouseoverfunc"] as const;

export type LegacyDiscuzStubName = (typeof LEGACY_DISCUZ_STUB_NAMES)[number];

/**
 * Install no-op stubs on the given target for any legacy Discuz global
 * that is not already defined. Returns the list of names that were
 * actually installed (i.e. the previously-undefined ones), so tests can
 * assert idempotency.
 */
export function installLegacyDiscuzStubs(target: LegacyDiscuzStubTarget): LegacyDiscuzStubName[] {
	const installed: LegacyDiscuzStubName[] = [];
	for (const name of LEGACY_DISCUZ_STUB_NAMES) {
		if (typeof target[name] !== "function") {
			// Variadic no-op — Discuz called these with `(this)` and
			// occasionally `(this, "load")` etc. Accept anything, return
			// nothing.
			target[name] = () => {};
			installed.push(name);
		}
	}
	return installed;
}

/**
 * Inline `<script>` body that installs the same stubs at document parse
 * time. Mounted from `app/layout.tsx` so it runs before any post HTML
 * hydrates and before browser-cached images fire their `onload`.
 *
 * Kept as a single self-executing expression with no module syntax so it
 * can be inlined verbatim — no transpiler involvement, no async, no
 * top-level await. Names list is intentionally hard-coded here (rather
 * than `JSON.stringify(LEGACY_DISCUZ_STUB_NAMES)`) so the produced source
 * stays readable when DevTools attributes the error to this script.
 */
export const LEGACY_DISCUZ_STUBS_SCRIPT =
	"(function(){try{var w=window;var n=['thumbImg','attachimg','img_onmouseoverfunc'];for(var i=0;i<n.length;i++){if(typeof w[n[i]]!=='function'){w[n[i]]=function(){};}}}catch(e){}})();";
