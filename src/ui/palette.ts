// Paleta dos itens do app em torno do verde (#c6ff3d); fundos e cinzas ficam os neutros do tema (theme.css).

/**
 * Cores de série e de classe (gráficos, barras, fatias): 8 matizes em ordem fixa, validados no escuro com a skill de dataviz
 * nos dois temas (luminosidade, croma ≥ 0,10, daltonismo ΔE ≥ 13,2 entre vizinhas, contraste ≥ 3:1 sobre o card escuro e o branco).
 * A ordem é a escolha que maximiza a separação mínima entre vizinhas; o verde abre por ser o da marca.
 */
export const SERIES = ['#6d9c04', '#3a91dc', '#dc5f52', '#956ed2', '#a77e33', '#009f99', '#c68206', '#cd6199'] as const

/** Os mesmos matizes num tom claro, para ícones e marcadores pequenos; no tema claro o CSS escurece (classe com --ico). */
export const TINT = {
  verde: '#aed37d', azul: '#83cbff', coral: '#ffa598', violeta: '#d0b2ff', areia: '#e3be80', turquesa: '#50ddd5', ambar: '#f4b768', rosa: '#ffa3cf', cinza: '#9a9da6' /* o cinza neutro do tema */,
} as const

/** Cor de um ícone ou avatar (.cat-ico, .tk-av, .sub-av): o CSS tira dela o traço e o fundo de cada tema. */
export const ico = (color: string) => ({ '--ico': color }) as import('react').CSSProperties
