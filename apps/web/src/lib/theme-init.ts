export const themeInitScript = `
(function(){
  var root = document.documentElement;
  var theme;
  try { theme = localStorage.getItem('theme'); } catch {}
  var dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme:dark)').matches);
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  try {
    if (localStorage.getItem('width-mode') === 'full') root.dataset.widthMode = 'full';
  } catch {}
})();
`.trim();
