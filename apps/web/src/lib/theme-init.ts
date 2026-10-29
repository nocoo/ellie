export function syncBrowserTheme() {
	const root = document.documentElement;
	const color = `hsl(${getComputedStyle(root).getPropertyValue("--card").trim()})`;
	for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
		meta.setAttribute("content", color);
	}
	document
		.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
		?.setAttribute("content", root.classList.contains("dark") ? "black-translucent" : "default");
}

export const themeInitScript = `
(function(){
  var root = document.documentElement;
  var theme;
  try { theme = localStorage.getItem('theme'); } catch {}
  var dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme:dark)').matches);
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  (${syncBrowserTheme.toString()})();
  try {
    if (localStorage.getItem('width-mode') === 'full') root.dataset.widthMode = 'full';
  } catch {}
})();
`.trim();
