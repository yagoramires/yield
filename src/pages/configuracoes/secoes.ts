import { fold } from '../../domain/gastos'
import { scoped } from '../../profiles/active'

/** Seções de Configurações, na ordem do menu; `words` são ajustes de dentro da seção que a busca também acha. */
export const SECTIONS = [
  { id: 'perfil', group: 'Você', label: 'Perfil e PIN', words: 'nome cor foto avatar pin senha criptografia bloquear apagar perfil' },
  { id: 'aparencia', group: 'Você', label: 'Aparência', words: 'tema claro escuro cores' },
  { id: 'abas', group: 'Você', label: 'Abas do menu', words: 'módulos telas sidebar gastos investimentos ligar desligar' },
  { id: 'contas', group: 'Dados', label: 'Contas conectadas', words: 'open finance pluggy meu pluggy bancos binance cripto contas cartões transferências seu nome empresa cnpj sincronizar' },
  { id: 'importar', group: 'Dados', label: 'Importar arquivos', words: 'b3 área do investidor negociação posição movimentação xlsx orçamento csv planilha' },
  { id: 'renda', group: 'Dados', label: 'Renda e orçamento', words: 'fontes de renda salário clt pj mei pró-labore' },
  { id: 'proventos', group: 'Dados', label: 'Proventos', words: 'dividendos jcp rendimentos' },
  { id: 'ia', group: 'Recursos', label: 'Assistente (IA)', words: 'ia local modelo inteligência artificial chat insights' },
  { id: 'cotacoes', group: 'Recursos', label: 'Cotações', words: 'yahoo finance atualizar preços' },
  { id: 'backup', group: 'App', label: 'Backup', words: 'exportar importar restaurar senha .yield' },
  { id: 'atualizacoes', group: 'App', label: 'Atualizações', words: 'versão nova versão github' },
  { id: 'privacidade', group: 'App', label: 'Privacidade', words: 'dados internet serviços' },
] as const

export type SectionId = (typeof SECTIONS)[number]['id']
export type Section = (typeof SECTIONS)[number]

/** Seções que batem com a busca: todas as palavras digitadas no nome, no grupo ou nos ajustes, sem acento e sem caixa. */
export function filterSections(query: string): Section[] {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  return SECTIONS.filter(s => {
    const text = fold(`${s.label} ${s.group} ${s.words}`)
    return terms.every(t => text.includes(t))
  })
}

const KEY = 'yield.configSecao'

/** Última seção aberta no perfil ativo; cai em Perfil sem storage ou com valor desconhecido. */
export function savedSection(): SectionId {
  try {
    const v = localStorage.getItem(scoped(KEY))
    return SECTIONS.find(s => s.id === v)?.id ?? 'perfil'
  } catch { return 'perfil' }
}

export function saveSection(id: SectionId): void {
  try { localStorage.setItem(scoped(KEY), id) } catch { /* sem storage, só não lembra */ }
}
