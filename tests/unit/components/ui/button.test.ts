import { describe, expect, it } from "bun:test";
import { buttonVariants } from "../../../../apps/web/src/components/ui/button";

// ---------------------------------------------------------------------------
// buttonVariants — class-variance-authority variant function
// ---------------------------------------------------------------------------

describe("buttonVariants", () => {
	// ---------------------------------------------------------------------------
	// Variant classes
	// ---------------------------------------------------------------------------

	describe("variant", () => {
		it("generates default variant classes", () => {
			const result = buttonVariants({ variant: "default" });
			expect(result).toContain("bg-primary");
			expect(result).toContain("text-primary-foreground");
		});

		it("generates outline variant classes", () => {
			const result = buttonVariants({ variant: "outline" });
			expect(result).toContain("border-border");
			expect(result).toContain("bg-background");
		});

		it("generates secondary variant classes", () => {
			const result = buttonVariants({ variant: "secondary" });
			expect(result).toContain("bg-secondary");
			expect(result).toContain("text-secondary-foreground");
		});

		it("generates ghost variant classes", () => {
			const result = buttonVariants({ variant: "ghost" });
			expect(result).toContain("hover:bg-muted");
			expect(result).toContain("hover:text-foreground");
		});

		it("generates destructive variant classes", () => {
			const result = buttonVariants({ variant: "destructive" });
			expect(result).toContain("text-destructive");
		});

		it("generates link variant classes", () => {
			const result = buttonVariants({ variant: "link" });
			expect(result).toContain("text-primary");
			expect(result).toContain("underline-offset-4");
		});
	});

	// ---------------------------------------------------------------------------
	// Size classes
	// ---------------------------------------------------------------------------

	describe("size", () => {
		it("generates default size classes", () => {
			const result = buttonVariants({ size: "default" });
			expect(result).toContain("h-8");
		});

		it("generates xs size classes", () => {
			const result = buttonVariants({ size: "xs" });
			expect(result).toContain("h-6");
		});

		it("generates sm size classes", () => {
			const result = buttonVariants({ size: "sm" });
			expect(result).toContain("h-7");
		});

		it("generates lg size classes", () => {
			const result = buttonVariants({ size: "lg" });
			expect(result).toContain("h-9");
		});

		it("generates icon size classes", () => {
			const result = buttonVariants({ size: "icon" });
			expect(result).toContain("size-8");
		});

		it("generates icon-xs size classes", () => {
			const result = buttonVariants({ size: "icon-xs" });
			expect(result).toContain("size-6");
		});

		it("generates icon-sm size classes", () => {
			const result = buttonVariants({ size: "icon-sm" });
			expect(result).toContain("size-7");
		});

		it("generates icon-lg size classes", () => {
			const result = buttonVariants({ size: "icon-lg" });
			expect(result).toContain("size-9");
		});
	});

	// ---------------------------------------------------------------------------
	// Defaults (no arguments)
	// ---------------------------------------------------------------------------

	describe("defaults", () => {
		it("uses default variant and size when none specified", () => {
			const result = buttonVariants();
			expect(result).toContain("bg-primary");
			expect(result).toContain("h-8");
		});

		it("uses default variant with explicit size", () => {
			const result = buttonVariants({ size: "lg" });
			expect(result).toContain("bg-primary");
			expect(result).toContain("h-9");
		});

		it("uses explicit variant with default size", () => {
			const result = buttonVariants({ variant: "ghost" });
			expect(result).toContain("hover:bg-muted");
			expect(result).toContain("h-8");
		});
	});

	// ---------------------------------------------------------------------------
	// Custom className merging
	// ---------------------------------------------------------------------------

	describe("className merging", () => {
		it("appends custom className", () => {
			const result = buttonVariants({ className: "my-custom-class" });
			expect(result).toContain("my-custom-class");
			// Still contains base classes
			expect(result).toContain("bg-primary");
		});

		it("merges conflicting tailwind classes (last wins)", () => {
			const result = buttonVariants({ className: "h-12" });
			// cn() appends the custom class; h-12 takes visual precedence via CSS cascade
			expect(result).toContain("h-12");
		});
	});

	// ---------------------------------------------------------------------------
	// Base classes always present
	// ---------------------------------------------------------------------------

	describe("base classes", () => {
		it("always includes inline-flex", () => {
			expect(buttonVariants()).toContain("inline-flex");
		});

		it("always includes rounded-lg", () => {
			expect(buttonVariants()).toContain("rounded-lg");
		});

		it("always includes font-medium", () => {
			expect(buttonVariants()).toContain("font-medium");
		});

		it("always includes disabled:opacity-50", () => {
			expect(buttonVariants()).toContain("disabled:opacity-50");
		});
	});
});
