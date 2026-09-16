// @vitest-environment happy-dom
import { FORUM_LOGOS } from "@ellie/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ForumLogo } from "@/components/forum/forum-logo";

afterEach(cleanup);

it("serves responsive versions of both existing forum wordmarks", () => {
	render(<ForumLogo height={52} lightSrc="https://t.no.mt/ellie/Logo-light-2.png" />);
	const [light, dark] = screen.getAllByRole("img");
	expect(light.getAttribute("src")).toBe(FORUM_LOGOS.light);
	expect(dark.getAttribute("src")).toBe(FORUM_LOGOS.dark);
	expect(light.getAttribute("srcset")).toContain("forum-logo-light-240.webp 240w");
	expect(dark.getAttribute("srcset")).toContain("forum-logo-dark-600.webp 600w");
	expect(light.getAttribute("width")).toBe("600");
	expect(light.getAttribute("height")).toBe("200");
});

it("keeps custom logo proportions, alt text and forced theme", () => {
	render(<ForumLogo height={32} variant="dark" darkSrc="/custom-square.svg" alt="校园论坛" />);
	const logo = screen.getByRole("img", { name: "校园论坛" });
	expect(logo.getAttribute("src")).toBe("/custom-square.svg");
	expect(logo.hasAttribute("srcset")).toBe(false);
	expect(logo.hasAttribute("width")).toBe(false);
	expect(logo.style.height).toBe("32px");
});

it("keeps an explicitly disabled logo absent", () => {
	render(<ForumLogo height={32} lightSrc="" variant="light" />);
	expect(screen.queryByRole("img")).toBeNull();
});
