// Shared dialog width presets for the admin app.
//
// Background: admin uses several wide "detail" dialogs (KV key detail,
// admin operation log detail, reports detail) that all want the same
// behaviour — fill a comfortable portion of the screen on wide
// monitors, never overflow horizontally on small ones, and scroll the
// body vertically when content is long. They were drifting apart
// (`sm:max-w-lg`, `sm:max-w-2xl`, `max-w-5xl`...), so this module
// pins the contract in one place.
//
// Two scopes only:
//   - WIDE: detail / inspection dialogs that benefit from horizontal
//     space (long URLs, JSON values, multi-column metadata).
//   - Confirmation and short-form dialogs intentionally stay on the
//     `@ellie/ui` Dialog default (`sm:max-w-sm` / `sm:max-w-md` /
//     `sm:max-w-lg`). Do NOT route them through this preset.
//
// Special cases that intentionally do NOT use this preset:
//   - `user-edit-dialog`: has a hand-tuned `sm:w-[640px] lg:w-[860px]`
//     two-column form layout with custom header/footer; widening it to
//     5xl would break the form grid.
//
// Pinned by `tests/unit/components/dialog-presets.test.ts`.

/**
 * `<DialogContent>` className for wide admin detail dialogs.
 * - `w-[calc(100vw-2rem)]`: fill the viewport on small screens minus
 *   the standard 1rem horizontal gutter on each side.
 * - `max-w-5xl`: cap on large screens so content stays readable.
 * - `overflow-hidden`: the dialog container never scrolls; the body
 *   region is responsible for its own scroll (see body class below).
 */
export const ADMIN_WIDE_DIALOG_CONTENT_CLASS = "w-[calc(100vw-2rem)] max-w-5xl overflow-hidden";

/**
 * Inner body wrapper className for wide admin detail dialogs.
 * - `min-w-0`: allow flex/grid children to shrink below their intrinsic
 *   width so long values don't push the dialog out.
 * - `max-h-[80vh] overflow-y-auto`: keep the dialog within the viewport
 *   even when content is long; leaves room for header/footer.
 */
export const ADMIN_WIDE_DIALOG_BODY_CLASS = "min-w-0 max-h-[80vh] overflow-y-auto";
