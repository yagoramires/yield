import { ChevronLeft, Search } from 'lucide-react'
import { Fragment, useState, type ReactNode } from 'react'
import { useAiSettings } from '../ai/settings'
import { useData } from '../state/DataProvider'
import { refreshLine } from './configuracoes/build'
import { Backup } from './configuracoes/Backup'
import { AtualizacaoCard } from '../ui/Atualizacao'
import { FontesRenda, ImportarOrcamento } from './configuracoes/OrcamentoConfig'
import { Contas, OpenFinance } from './configuracoes/OpenFinance'
import { Binance } from './configuracoes/Binance'
import { Proventos } from './configuracoes/Proventos'
import { Modulos } from './configuracoes/Modulos'
import { Aparencia } from './configuracoes/Aparencia'
import { IaLocal } from './configuracoes/IaLocal'
import { Perfil } from './configuracoes/Perfil'
import { useB3Import } from './configuracoes/useB3Import'
import { filterSections, savedSection, saveSection, SECTIONS, type SectionId } from './configuracoes/secoes'

const dayTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function ImportarB3() {
  const b3 = useB3Import()
  return (
    <div className="card">
      <b style={{ color: 'var(--strong)' }}>Importar da B3</b>
      <div className="muted" style={{ margin: '4px 0 10px' }}>Relatórios de Negociação, Proventos Recebidos, Movimentação e Posição (.xlsx) da Área do Investidor; a Posição também preenche o cadastro de empresas do IR. Dá para escolher vários de uma vez; o que já existe é pulado.</div>
      {b3.button('Escolher arquivos…', 'b pri')}
      {b3.panel}
    </div>
  )
}

function Cotacoes() {
  const { data, refreshing, refreshQuotesNow, lastRefresh } = useData()
  const yahooTimes = data.quotes.filter(q => q.source === 'yahoo').map(q => q.fetchedAt).sort()
  const lastQuote = yahooTimes[yahooTimes.length - 1]
  return (
    <div className="card">
      <b style={{ color: 'var(--strong)' }}>Cotações</b>
      <div className="muted" style={{ margin: '4px 0 10px' }}>Yahoo Finance, atraso de ~15 min</div>
      <div className="row"><span className="t2">Atualiza a cada 15 min</span><button className="b ghost" disabled={refreshing} onClick={() => void refreshQuotesNow()}>{refreshing ? 'Atualizando…' : '↻ Atualizar agora'}</button></div>
      <div className="muted" style={{ marginTop: 8 }}>
        Última: {lastRefresh ? `${dayTime(lastRefresh.at)} · ${refreshLine(lastRefresh)}` : lastQuote ? dayTime(lastQuote) : 'nenhuma ainda'}
      </div>
    </div>
  )
}

const Privacidade = () => (
  <div className="card">
    <b style={{ color: 'var(--strong)' }}>Tudo fica neste computador</b>
    <div className="muted" style={{ marginTop: 4 }}>O app só fala com o Yahoo Finance (cotações), o Banco Central em api.bcb.gov.br (CDI), a Pluggy em api.pluggy.ai (leitura dos seus bancos), a Binance em api.binance.com (saldos de cripto) e o GitHub (atualizações do app).</div>
  </div>
)

const BODY: Record<SectionId, () => ReactNode> = {
  perfil: () => <Perfil />,
  aparencia: () => <Aparencia />,
  abas: () => <Modulos />,
  contas: () => <><OpenFinance /><Binance /><Contas /></>,
  importar: () => <><ImportarB3 /><div style={{ marginTop: 12 }}><ImportarOrcamento /></div></>,
  renda: () => <FontesRenda />,
  proventos: () => <Proventos />,
  ia: () => <IaLocal />,
  cotacoes: () => <Cotacoes />,
  backup: () => <Backup />,
  atualizacoes: () => <AtualizacaoCard />,
  privacidade: () => <Privacidade />,
}

/** `at`: seção pedida por um link de outra tela; sem ele abre a última seção usada no perfil. */
export function Configuracoes({ at }: { at?: SectionId }) {
  const [section, setSection] = useState<SectionId>(() => { if (at) saveSection(at); return at ?? savedSection() })
  const [open, setOpen] = useState(!!at) // no celular: menu de seções ou a seção aberta
  const [query, setQuery] = useState('')
  const { gastos, binance } = useData()
  const ai = useAiSettings()
  const badges: Partial<Record<SectionId, ReactNode>> = {
    contas: (gastos.lastSyncResult?.errors.length || binance.error) && <span className="pill bad">erro</span>,
    ia: ai.off !== false && <span className="pill">off</span>,
  }

  const go = (id: SectionId) => { setSection(id); setOpen(true); saveSection(id) }
  const shown = filterSections(query)
  const current = SECTIONS.find(s => s.id === section)!

  return (
    <>
      <h1>Configurações</h1>
      <div className={`cfg${open ? ' open' : ''}`}>
        <nav className="cfg-nav" aria-label="Seções de Configurações">
          <label className="cfg-search">
            <Search size={14} aria-hidden />
            <input className="in" type="search" placeholder="Buscar ajuste…" aria-label="Buscar ajuste" value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && shown[0]) go(shown[0].id); if (e.key === 'Escape') setQuery('') }} />
          </label>
          {shown.length === 0 && <div className="muted" style={{ padding: '8px 10px' }}>Nada encontrado</div>}
          {shown.map((s, i) => (
            <Fragment key={s.id}>
              {shown[i - 1]?.group !== s.group && <div className="group">{s.group}</div>}
              <button className={`item${s.id === section ? ' on' : ''}`} aria-current={s.id === section ? 'page' : undefined} onClick={() => go(s.id)}>
                <span className="lbl">{s.label}</span>{badges[s.id]}
              </button>
            </Fragment>
          ))}
        </nav>
        <section className="cfg-body" aria-label={current.label}>
          <button className="b ghost cfg-back" onClick={() => setOpen(false)}><ChevronLeft size={14} aria-hidden /> Configurações</button>
          {BODY[section]()}
        </section>
      </div>
    </>
  )
}
