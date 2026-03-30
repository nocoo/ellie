// FOUC prevention: apply theme and width-mode before first paint.
// Must run synchronously before React hydrates. Loaded via
// <Script strategy="beforeInteractive"> in layout.tsx.
(() => {
	try {
		const t = localStorage.getItem("theme");
		const d = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme:dark)").matches);
		if (d) document.documentElement.classList.add("dark");
	} catch (_e) {}
	try {
		const m = localStorage.getItem("width-mode");
		if (m === "full") document.documentElement.dataset.widthMode = "full";
	} catch (_e) {}
})();
