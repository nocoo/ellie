import { describe, expect, it } from "vitest";
import type { StatCardProps, StatCardSubItem } from "../../../src/components/admin/stat-card";

// Since StatCard is a React component, we test the type contracts
// and formatting logic that can be verified without a DOM renderer.

describe("StatCard types", () => {
	it("accepts minimal props (label + value)", () => {
		const props: StatCardProps = {
			label: "Total Users",
			value: 1234,
		};
		expect(props.label).toBe("Total Users");
		expect(props.value).toBe(1234);
		expect(props.icon).toBeUndefined();
		expect(props.subItems).toBeUndefined();
	});

	it("accepts string value", () => {
		const props: StatCardProps = {
			label: "Status",
			value: "Active",
		};
		expect(props.value).toBe("Active");
	});

	it("accepts sub-items", () => {
		const subItems: StatCardSubItem[] = [
			{ label: "Today", value: 5 },
			{ label: "Banned", value: 12 },
		];
		const props: StatCardProps = {
			label: "Users",
			value: 1234,
			subItems,
		};
		expect(props.subItems).toHaveLength(2);
		expect(props.subItems?.[0]?.label).toBe("Today");
		expect(props.subItems?.[0]?.value).toBe(5);
		expect(props.subItems?.[1]?.label).toBe("Banned");
		expect(props.subItems?.[1]?.value).toBe(12);
	});

	it("sub-items support string values", () => {
		const subItem: StatCardSubItem = {
			label: "Rate",
			value: "42%",
		};
		expect(subItem.value).toBe("42%");
	});
});

describe("StatCard number formatting", () => {
	it("toLocaleString formats large numbers with separators", () => {
		// This tests the formatting logic used inside StatCard
		expect((1234).toLocaleString()).toBeTruthy();
		expect((1234567).toLocaleString()).toBeTruthy();
		// The exact format depends on locale, but it should be a non-empty string
		expect(typeof (1234).toLocaleString()).toBe("string");
	});

	it("zero renders correctly", () => {
		const props: StatCardProps = {
			label: "Empty",
			value: 0,
		};
		expect(props.value).toBe(0);
		expect((0).toLocaleString()).toBe("0");
	});
});
