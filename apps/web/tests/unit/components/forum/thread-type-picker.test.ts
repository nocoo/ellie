// @vitest-environment happy-dom

import type { ForumThreadType } from "@ellie/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadTypePicker } from "@/components/forum/thread-type-picker";

const mkType = (id: number, name: string): ForumThreadType => ({
	id,
	name,
	displayOrder: 0,
	icon: "",
	enabled: true,
	moderatorOnly: false,
});

const TYPES: ForumThreadType[] = [mkType(11, "求购"), mkType(12, "出售"), mkType(13, "置换")];

afterEach(() => {
	cleanup();
});

describe("<ThreadTypePicker />", () => {
	it("returns null when types is empty (no UI noise)", () => {
		const { container } = render(
			createElement(ThreadTypePicker, { types: [], value: null, onChange: () => {} }),
		);
		expect(container.firstChild).toBeNull();
	});

	it("renders 不选 + every type when not required", () => {
		render(createElement(ThreadTypePicker, { types: TYPES, value: null, onChange: () => {} }));
		expect(screen.getByText("不选")).toBeTruthy();
		for (const t of TYPES) {
			expect(screen.getByText(t.name)).toBeTruthy();
		}
	});

	it("hides 不选 when required", () => {
		render(
			createElement(ThreadTypePicker, {
				types: TYPES,
				value: null,
				onChange: () => {},
				required: true,
			}),
		);
		expect(screen.queryByText("不选")).toBeNull();
		// Required asterisk visible
		expect(screen.getByText("*")).toBeTruthy();
	});

	it("marks the selected pill aria-checked=true", () => {
		render(createElement(ThreadTypePicker, { types: TYPES, value: 12, onChange: () => {} }));
		const sellPill = screen.getByText("出售").closest("button");
		expect(sellPill?.getAttribute("aria-checked")).toBe("true");
		// And 不选 (since not required + value != null) is not active
		const skipPill = screen.getByText("不选").closest("button");
		expect(skipPill?.getAttribute("aria-checked")).toBe("false");
	});

	it("clicking a pill calls onChange with that id", () => {
		const onChange = vi.fn();
		render(createElement(ThreadTypePicker, { types: TYPES, value: null, onChange }));
		fireEvent.click(screen.getByText("求购"));
		expect(onChange).toHaveBeenCalledWith(11);
	});

	it("clicking 不选 calls onChange with null", () => {
		const onChange = vi.fn();
		render(createElement(ThreadTypePicker, { types: TYPES, value: 11, onChange }));
		fireEvent.click(screen.getByText("不选"));
		expect(onChange).toHaveBeenCalledWith(null);
	});

	it("renders inline error", () => {
		render(
			createElement(ThreadTypePicker, {
				types: TYPES,
				value: null,
				onChange: () => {},
				required: true,
				error: "请选择主题分类",
			}),
		);
		expect(screen.getByText("请选择主题分类")).toBeTruthy();
	});

	it("disables all pills when `disabled` is true", () => {
		render(
			createElement(ThreadTypePicker, {
				types: TYPES,
				value: 11,
				onChange: () => {},
				disabled: true,
			}),
		);
		for (const t of TYPES) {
			const pill = screen.getByText(t.name).closest("button");
			expect(pill?.hasAttribute("disabled")).toBe(true);
		}
	});
});
