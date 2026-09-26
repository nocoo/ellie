// @vitest-environment happy-dom

import { getThreadBadges } from "@ellie/types";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it } from "vitest";
import { DigestIcon } from "@/components/forum/digest-icon";
import { ThreadBadgeList } from "@/components/forum/thread-badge";

afterEach(cleanup);
it.each([1, 2, 3])("renders digest level %s as an icon instead of a badge", (level) => {
	const badges = getThreadBadges({ digest: level, sticky: 0, closed: 0, special: 0, typeName: "" });
	render(createElement(ThreadBadgeList, { badges, digestLevel: level }));
	expect(screen.getByRole("img").getAttribute("src")).toBe(`/icons/digest_${level}.svg`);
	expect(screen.queryByTestId("thread-badge")).toBeNull();
});
it("does not mark ordinary posts as digest", () => {
	render(createElement(DigestIcon, { level: 0 }));
	expect(screen.queryByRole("img")).toBeNull();
});
