import { describe, expect, it, vi } from "vitest";
import { handleSubmitShortcut } from "@/lib/composer-keyboard";

interface MockKeyboardOptions {
	key?: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
	isComposing?: boolean;
	keyCode?: number;
	repeat?: boolean;
}

function createKeyboardEvent(options: MockKeyboardOptions = {}) {
	const preventDefault = vi.fn();
	const stopPropagation = vi.fn();
	const event = {
		key: options.key ?? "Enter",
		ctrlKey: options.ctrlKey ?? false,
		metaKey: options.metaKey ?? false,
		altKey: options.altKey ?? false,
		shiftKey: options.shiftKey ?? false,
		isComposing: options.isComposing ?? false,
		keyCode: options.keyCode ?? 13,
		repeat: options.repeat ?? false,
		preventDefault,
		stopPropagation,
	} as unknown as KeyboardEvent;

	return { event, preventDefault, stopPropagation };
}

describe("handleSubmitShortcut", () => {
	it.each<MockKeyboardOptions>([
		{ key: "Enter" },
		{ key: "a", ctrlKey: true },
		{ key: "Enter", ctrlKey: true, shiftKey: true },
		{ key: "Enter", ctrlKey: true, altKey: true },
		{ key: "Enter", ctrlKey: true, isComposing: true },
		{ key: "Enter", ctrlKey: true, keyCode: 229 },
	])("returns false without preventing default or submitting: %j", (init) => {
		const { event, preventDefault, stopPropagation } = createKeyboardEvent(init);
		const submit = vi.fn();
		expect(handleSubmitShortcut(event, submit)).toBe(false);
		expect(preventDefault).not.toHaveBeenCalled();
		expect(stopPropagation).not.toHaveBeenCalled();
		expect(submit).not.toHaveBeenCalled();
	});

	it.each(["ctrlKey", "metaKey"] as const)(
		"returns true and submits once when %s + Enter is pressed",
		(modifier) => {
			const { event, preventDefault, stopPropagation } = createKeyboardEvent({
				key: "Enter",
				[modifier]: true,
			});
			const submit = vi.fn();
			expect(handleSubmitShortcut(event, submit)).toBe(true);
			expect(preventDefault).toHaveBeenCalledOnce();
			expect(stopPropagation).toHaveBeenCalledOnce();
			expect(submit).toHaveBeenCalledOnce();
		},
	);

	it("returns true and suppresses submit on key repeat", () => {
		const { event, preventDefault, stopPropagation } = createKeyboardEvent({
			key: "Enter",
			ctrlKey: true,
			repeat: true,
		});
		const submit = vi.fn();
		expect(handleSubmitShortcut(event, submit)).toBe(true);
		expect(preventDefault).toHaveBeenCalledOnce();
		expect(stopPropagation).toHaveBeenCalledOnce();
		expect(submit).not.toHaveBeenCalled();
	});
});
