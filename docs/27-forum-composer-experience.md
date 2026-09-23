# Forum composer and interaction experience

## Root causes

Chrome reproduced the reported failure: Enter did not split a paragraph, and Ctrl+Enter submitted after changing the document. Two faults interacted:

1. Tiptap loaded multiple versions of the ProseMirror model runtime. Paragraph splitting threw `Can not convert <> to a Fragment`.
2. The React submission handler ran after ProseMirror's modified-Enter hard-break binding.

The dependency graph now resolves one version of each ProseMirror runtime package. `PostEditor` consumes submission shortcuts in `editorProps.handleKeyDown`, before editor commands run. Dialog and page wrappers no longer compete for the same event.

## Editing contract

| Action | Behavior |
| --- | --- |
| Enter | Insert a paragraph or a newline in a plain-text message/comment. |
| Ctrl+Enter | Submit on Windows and macOS, preserving the document and caret content. |
| Cmd+Enter | An additional macOS submission shortcut. |
| IME confirmation / held shortcut | Composition never submits; a held key cannot repeatedly submit. |
| Formatting | Paragraphs/headings, bold, italic, underline, strike, lists, quotes, code, links, emoji, undo/redo, and clear formatting. |
| Preview | Render the title, quoted context, and body with the same sanitizer and typography as published content. |
| Images | Select multiple files, paste, or drop JPG/PNG/WebP/GIF images up to 5 MB each. Show progress, retain failed files for retry, and preserve the insertion position while typing continues. |
| Pending request | Block duplicate submission and dialog dismissal; retain input on failure. Image upload blocks publication while allowing continued writing. |

The forum's existing Base UI controls provide tabs, menus, popovers, tooltips, recipient selection, and toast behavior. Colors and spacing use the current design tokens. Compact headers and responsive toolbars preserve writing space, including short landscape viewports. Motion honors `prefers-reduced-motion`.

### Draft lifetime

Post, reply, and edit drafts use `sessionStorage`, scoped by user and destination. Thread drafts include the title and category; quoted replies include the quote identity in their key. Drafts survive reloads and canceled dialogs in the same tab. Successful writes clear the corresponding draft; failed writes retain it. Storage failures show a visible warning.

This is tab-local recovery, not a cross-device or server-side draft service. Fields wait for restoration before accepting edits so initialization cannot overwrite early input. Changing editor editability does not emit an artificial content update that could recreate a cleared draft.

## Interaction audit

| Surface | Result |
| --- | --- |
| New thread, reply, edit, quoted reply | Shared rich editor, preview, isolated drafts, validation, pending guards, retained failed input, and success/error feedback. Quote author, date, and snippet are escaped in both preview and submission. |
| Post action bars and comments | One responsive content/action tree prevents duplicate portaled dialogs. Comments support multiline input, the shared submit shortcut, load retry, write gates, and submission guards. |
| Private messages | Base UI recipient combobox with keyboard selection and retry; stale searches cannot replace newer results. Compose, conversation loading, sending, reading, and deletion show pending/error states and preserve failed input. |
| Ratings and revocation | Retain score and reason on failure, reject fractional scores, guard repeated writes, and offer detail-load retry. Revocation follows the server's `canRevoke` permission. |
| Reports | Preserve CAPTCHA and email gates, show accessible validation/errors, and block duplicate or already-completed submissions. |
| Profile, avatar, email verification | Guard uploads, saves, and verification requests synchronously. Profile save/close waits for avatar upload; failed requests remain actionable. |
| User moderation | Retain the confirmation after failure, prevent duplicate execution, show status-load retry, and reject stale status results after changing users. |
| Thread moderation, move, title edit, check-in, announcements | Reviewed existing pending guards and visible error handling; retain the established confirmation, refresh, and feedback flows. |
| Navigation and reading | Browser regressions cover forums, threads, pagination, profile tabs, messages, search, themes, mobile overflow, and short dialogs. |

Toast messages use Base UI's queue, dismissal, hover/focus pause, and swipe behavior. Errors remain visible longer than success messages, and critical form failures also remain inline.

There is no active like/unlike endpoint or button in this checkout. Thread rows only display historical `recommends` counts; staff-controlled recommended threads are a separate feature. This change does not add a new voting backend.

## Verification and local review

The review stack runs behind `https://ellie.dev.hexly.ai`: the built forum listens on port 7031 and proxies to the local Worker on port 8788. The Worker uses `.wrangler/state/editor-review`, seeded test accounts, and explicit test credentials. The default web `.env.local` can point to production; override `WORKER_API_URL`, `FORUM_API_KEY`, `JWT_SECRET`, `AUTH_SECRET`, and `AUTH_URL` when starting this stack. The API health response must identify `environment: test`.

The test account is `e2etest` / `e2etest123`. Open `/forums/1/new-thread` for composition and `/threads/662174` for replies, quotes, ratings, comments, and reporting.

Focused browser regression sources are `tests/e2e/bdd/editor.spec.ts` and `tests/e2e/bdd/interactions.spec.ts`. They join the existing stateful Playwright project. The local Chrome run also includes the content, social, mobile, navigation, and system specifications.

Recorded local evidence on 2026-09-23:

- `bun run build:forum`: passed; browser review uses the generated standalone server.
- Root typecheck and strict Biome checks: passed.
- Full web coverage: 162 files and 2,399 tests passed; statements 96.32%, branches 94.11%, functions 95.91%, lines 97.32%.
- Chrome: 67 runnable scenarios passed across the combined run and focused rerun, with two existing skips. The combined run initially passed 65 scenarios; after correcting a selector that also matched Next.js's route announcer and awaiting native selection change before a synthetic paste, both affected scenarios passed three consecutive times. No application change was needed for those test-harness corrections.
- OSV scan of `bun.lock`: 570 packages scanned, no issues found.
- Desktop and mobile composer/preview screens, dark mode, and recipient search were visually inspected.

Verification limits:

- Windows and macOS editor keymaps are exercised in Chrome by varying `navigator.platform`; this is not a native Windows host run.
- Browser tests exercise real local thread/reply/edit/delete, message, comment, and image-upload requests. Error paths use intercepted responses. The rating revocation scenario uses a mocked staff-granted response rather than an administrator login.
- Report CAPTCHA gating is browser-tested; successful report responses are covered by unit mocks. Real CAPTCHA, OAuth, and email delivery are separate manual lanes.
- Existing browser skips cover the real CAPTCHA login flow and a legacy pagination selector without a matching seeded link.
- The web coverage run passes the configured thresholds. Its branch coverage is below the handbook's planned all-four-metrics 95% target; this work does not claim full 6DQ certification.
