// Runs before the stylesheet paints, so a dark window never flashes light.
try {
  var theme = localStorage.getItem('dsh.theme')
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme
} catch (e) {}
