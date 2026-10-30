// Paleta dos itens do app em torno do verde (#c6ff3d); fundos e cinzas ficam os neutros do tema (theme.css).

/**
 * Cores de série e de classe (gráficos, barras, fatias): 8 matizes em ordem fixa, validados no escuro com a skill de dataviz
 * (luminosidade 0,48–0,67, croma ≥ 0,10, daltonismo ΔE ≥ 13,5 entre vizinhas, contraste ≥ 3:1 sobre os cards).
 * A ordem é a escolha que maximiza a separação mínima entre vizinhas; o verde abre por ser o da marca.
 */
export const SERIES = ['#73a40a', '#3a91dc', '#dc5f52', '#956ed2', '#a77e33', '#18a7a1', '#c68206', '#cd6199'] as const

/** Os mesmos matizes num tom claro, para ícones e marcadores pequenos (glifo sobre fundo escuro). */
export const TINT = {
  verde: '#aed37d', azul: '#83cbff', coral: '#ffa598', violeta: '#d0b2ff', areia: '#e3be80', turquesa: '#50ddd5', ambar: '#f4b768', rosa: '#ffa3cf', cinza: '#9a9da6' /* o cinza neutro do tema */,
} as const
