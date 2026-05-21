// Vitest setup for apps/web — applied before every test file.
//
// We bump @testing-library/react's default async timeouts because the
// pre-commit hook runs `bun run test:coverage` in parallel with `test:l2`
// (which spawns wrangler dev and seeds a local D1). Under that contention,
// the default 1000ms `waitFor` budget is occasionally too tight for the
// DOM-heavy forum component tests (toast portal mount, post comment list
// hydration). Bumping the budget to 5s keeps the tests deterministic in
// the hook without changing what they assert.

import { configure } from "@testing-library/react";

configure({
	asyncUtilTimeout: 5000,
});
