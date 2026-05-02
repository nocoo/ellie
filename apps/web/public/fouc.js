(() => {
	try {
		const t = localStorage.getItem("theme");
		const d = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme:dark)").matches);
		if (d) {
			document.documentElement.classList.add("dark");
			document.documentElement.style.colorScheme = "dark";
		} else {
			document.documentElement.style.colorScheme = "light";
		}
	} catch (_e) {}
	try {
		const m = localStorage.getItem("width-mode");
		if (m === "full") document.documentElement.dataset.widthMode = "full";
	} catch (_e) {}
})();
