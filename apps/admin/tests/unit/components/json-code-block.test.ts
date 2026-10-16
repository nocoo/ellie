import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { JsonCodeBlock } from "../../../src/components/admin/json-code-block";

it.each(["long text", { items: Array.from({ length: 100 }, (_, index) => index) }])(
	"leaves vertical scrolling to the parent for %j",
	(value) => {
		const html = renderToStaticMarkup(createElement(JsonCodeBlock, { value }));
		expect(html).toContain("overflow-x-auto");
		expect(html).not.toMatch(/max-h-/);
	},
);
