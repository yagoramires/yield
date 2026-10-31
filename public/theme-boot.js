// Tema antes do CSS e do React: quem usa o claro não vê o escuro piscar ao abrir. Mesma regra de src/ui/theme.tsx.
try {
  var m = localStorage.getItem('yield.tema')
  var light = m === 'light' || (m === 'system' && matchMedia('(prefers-color-scheme: light)').matches)
  document.documentElement.dataset.theme = light ? 'light' : 'dark'
} catch (e) { /* sem storage: fica o escuro */ }
