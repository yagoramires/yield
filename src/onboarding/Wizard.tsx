import { invoke } from '@tauri-apps/api/core'
import { CalendarRange, ChartLine, Check, CircleOff, ReceiptText, Sparkles, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { gb, machineLabel, pickModel, type Hardware } from '../ai/catalog'
import { getHardware } from '../ai/server'
import { setAiSettings, useAiSettings } from '../ai/settings'
import { ImportarB3 } from '../pages/Configuracoes'
import { Binance } from '../pages/configuracoes/Binance'
import { OpenFinance } from '../pages/configuracoes/OpenFinance'
import { ImportarOrcamento } from '../pages/configuracoes/OrcamentoConfig'
import { PinConfig } from '../pages/configuracoes/PinConfig'
import { useProfiles } from '../profiles/Gate'
import { ProfileForm } from '../profiles/ProfileForm'
import { useData } from '../state/DataProvider'
import { useModules } from '../ui/prefs'
import { ROUTES, type Module } from '../ui/routes'
import { setOnboarding, SETUP_STEPS } from './state'

const STEPS = [
  { t: 'Seu perfil', d: 'nome, foto e PIN' },
  { t: 'Como você quer usar', d: 'abas do menu' },
  { t: 'Conectar contas', d: 'bancos e arquivos' },
  { t: 'Assistente com IA', d: 'opcional' },
  { t: 'Pronto', d: 'resumo' },
]

const USES: { key: Module; icon: LucideIcon; title: string; text: string }[] = [
  { key: 'gastos', icon: ReceiptText, title: 'Meus gastos', text: 'Ver para onde vai o dinheiro, mês a mês' },
  { key: 'orcamento', icon: CalendarRange, title: 'Orçamento', text: 'Planejar ganhos, custos, metas e reserva' },
  { key: 'investimentos', icon: ChartLine, title: 'Investimentos', text: 'Carteira, proventos e imposto de renda' },
]
const tabsOf = (m: Module) => ROUTES.find(g => g.module === m)?.items.map(i => i.label) ?? []

/** Escolhas de uso → módulos desligados (os não marcados). */
export const disabledFrom = (chosen: Module[]): Module[] => USES.map(u => u.key).filter(k => !chosen.includes(k))

/** Setup inicial em tela cheia: na instalação nova e em cada perfil criado. O passo fica gravado, então fechar o app no meio volta onde parou. */
export function Wizard({ step }: { step: number }) {
  const { profile, profiles, save, hasPin } = useProfiles()
  const modules = useModules()
  const ai = useAiSettings()
  const { gastos, data } = useData()
  const [uses, setUses] = useState<Module[]>(() => USES.map(u => u.key).filter(k => !modules.disabled.includes(k)))
  const [iaChoice, setIaChoice] = useState<'sim' | 'nao' | null>(ai.off === null ? null : ai.off ? 'nao' : 'sim')
  const [hw, setHw] = useState<Hardware | null>(null)
  const [tour, setTour] = useState(true)
  useEffect(() => { if (step === 3) getHardware().then(setHw, () => {}) }, [step])

  const go = (n: number) => setOnboarding({ setup: Math.max(0, Math.min(n, SETUP_STEPS - 1)) })
  const pick = hw ? pickModel(hw) : null
  const model = pick && 'model' in pick ? pick.model : null

  const next = () => {
    if (step === 1) modules.set(disabledFrom(uses))
    if (step === 3) {
      if (iaChoice === 'sim' && model) {
        setAiSettings({ off: false, modelId: model.id, tokS: null })
        // baixa em segundo plano; o Assistente mostra o andamento (vem do Rust) e liga quando terminar
        void invoke('ai_download', { url: model.url, sha256: model.sha256, file: model.file, bytes: model.bytes }).catch(() => {})
      } else setAiSettings({ off: true })
    }
    go(step + 1)
  }
  const skip = () => { if (step === 3 && ai.off === null) setAiSettings({ off: true }); go(step + 1) }
  const finish = () => setOnboarding({ setup: null, tour })

  const others = profiles.filter(p => p.id !== profile.id)
  const salvarPerfil = async (v: { name: string; color: string; avatar: string | null }) => {
    await save({ version: 1, profiles: profiles.map(p => (p.id === profile.id ? { ...p, ...v } : p)) })
    go(1)
  }

  return (
    <div className="wz">
      <aside className="wz-l">
        <div className="logo">yield<b>.</b></div>
        <ol className="wz-steps">
          {STEPS.map((s, i) => (
            <li key={s.t} className={i < step ? 'done' : i === step ? 'cur' : undefined} aria-current={i === step ? 'step' : undefined}>
              <span className="k">{i < step ? <Check size={12} aria-hidden /> : i + 1}</span>
              <span>{s.t}<small>{s.d}</small></span>
            </li>
          ))}
        </ol>
        <div className="muted wz-hint">Tudo aqui dá para mudar depois em Configurações.</div>
      </aside>
      <main className="wz-r">
        <div className="muted wz-count">Passo {step + 1} de {SETUP_STEPS}</div>
        {step === 0 && <>
          <h1>Vamos começar</h1>
          <p className="lead">Como a gente te chama? O PIN é opcional: serve para quando mais alguém usa este computador.</p>
          <ProfileForm id="wz-perfil" initial={profile} others={others} submitLabel="Continuar" actions={false} onSubmit={salvarPerfil} />
          <PinConfig />
        </>}
        {step === 1 && <>
          <h1>O que você quer acompanhar?</h1>
          <p className="lead">Escolha um ou mais. Cada escolha liga as abas do menu correspondentes.</p>
          <div className="wz-choice" role="group" aria-label="Como você quer usar">
            {USES.map(u => {
              const on = uses.includes(u.key)
              return (
                <button key={u.key} type="button" className={`wz-ch${on ? ' sel' : ''}`} aria-pressed={on}
                  onClick={() => setUses(on ? uses.filter(k => k !== u.key) : [...uses, u.key])}>
                  <span className="tick" aria-hidden>{on && <Check size={12} />}</span>
                  <u.icon size={20} aria-hidden />
                  <b>{u.title}</b>
                  <span className="t2">{u.text}</span>
                  <span className="muted">{tabsOf(u.key).join(' · ')}</span>
                </button>
              )
            })}
          </div>
          {uses.length === 0 && <div className="note" style={{ marginTop: 12 }}>Escolha pelo menos um.</div>}
        </>}
        {step === 2 && <>
          <h1>Conectar suas contas</h1>
          <p className="lead">Só leitura: o yield nunca movimenta dinheiro. Dá para pular e conectar ou importar depois em Configurações.</p>
          <div className="wz-cards">
            <OpenFinance />
            {!modules.disabled.includes('investimentos') && <><Binance /><div style={{ marginTop: 12 }}><ImportarB3 /></div></>}
            {!modules.disabled.includes('orcamento') && <div style={{ marginTop: 12 }}><ImportarOrcamento /></div>}
          </div>
        </>}
        {step === 3 && <>
          <h1>Quer usar o Assistente?</h1>
          <p className="lead">Uma IA que roda neste computador, responde perguntas sobre seus gastos e investimentos e aponta o que importa no mês. Nenhum dado financeiro sai daqui.</p>
          <div className="wz-choice two" role="radiogroup" aria-label="Usar o Assistente">
            <button type="button" role="radio" aria-checked={iaChoice === 'sim'} className={`wz-ch${iaChoice === 'sim' ? ' sel' : ''}`} disabled={!model} onClick={() => setIaChoice('sim')}>
              <span className="tick" aria-hidden>{iaChoice === 'sim' && <Check size={12} />}</span>
              <Sparkles size={20} aria-hidden />
              <b>Sim, quero o Assistente</b>
              <span className="t2">{!hw ? 'Vendo o que este computador aguenta…' : model ? `Baixa o ${model.name} (${gb(model.bytes)}) em segundo plano, uma vez só. ${machineLabel(hw)}.` : pick && 'unavailable' in pick ? pick.unavailable : ''}</span>
            </button>
            <button type="button" role="radio" aria-checked={iaChoice === 'nao'} className={`wz-ch${iaChoice === 'nao' ? ' sel' : ''}`} onClick={() => setIaChoice('nao')}>
              <span className="tick" aria-hidden>{iaChoice === 'nao' && <Check size={12} />}</span>
              <CircleOff size={20} aria-hidden />
              <b>Agora não</b>
              <span className="t2">A aba some do menu. Dá para ligar depois em Configurações › Assistente (IA).</span>
            </button>
          </div>
        </>}
        {step === 4 && <>
          <h1>Tudo pronto, {profile.name}</h1>
          <p className="lead">Seu yield ficou assim. Dá para mudar qualquer coisa em Configurações.</p>
          <div className="conn-list wz-sum">
            <div className="conn-row"><div className="grow"><b>Perfil</b><div className="muted">{profile.name} · {hasPin ? 'com PIN' : 'sem PIN'}</div></div></div>
            <div className="conn-row"><div className="grow"><b>Abas</b><div className="muted">{USES.filter(u => !modules.disabled.includes(u.key)).map(u => u.title).join(', ')}</div></div></div>
            <div className="conn-row"><div className="grow"><b>Contas</b><div className="muted">{[
              gastos.data.pluggyItems.length ? `${gastos.data.pluggyItems.length} ${gastos.data.pluggyItems.length === 1 ? 'banco' : 'bancos'} pelo Open Finance` : null,
              data.cryptoBalances.length ? 'Binance conectada' : null,
            ].filter(Boolean).join(' · ') || 'Nenhuma ainda'}</div></div></div>
            <div className="conn-row"><div className="grow"><b>Assistente</b><div className="muted">{ai.off === false ? 'Ligado; o modelo baixa em segundo plano' : 'Desligado'}</div></div></div>
          </div>
          <label className="toggle-row" style={{ marginTop: 16, maxWidth: 560 }}>
            <span>Mostrar um tour rápido pelo app<small>4 ou 5 balões apontando onde fica cada coisa</small></span>
            <input type="checkbox" className="switch" role="switch" checked={tour} onChange={e => setTour(e.target.checked)} />
          </label>
        </>}
        <div className="wz-foot">
          {step > 0 && <button type="button" className="b" onClick={() => go(step - 1)}>Voltar</button>}
          <span className="sp" />
          {step > 0 && step < SETUP_STEPS - 1 && <button type="button" className="b ghost" onClick={skip}>Pular</button>}
          {step === 0 ? <button type="submit" form="wz-perfil" className="b pri">Continuar</button>
            : step < SETUP_STEPS - 1 ? <button type="button" className="b pri" disabled={(step === 1 && !uses.length) || (step === 3 && !iaChoice)} onClick={next}>Continuar</button>
              : <button type="button" className="b pri" onClick={finish}>Abrir o yield</button>}
        </div>
      </main>
    </div>
  )
}
