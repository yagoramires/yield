import { useEffect, useState, type ReactNode } from 'react'

// Caminho conferido no dashboard da Pluggy em 27/10/2026 (ver docs/roteiro-pluggy.md).
const STEPS: { title: string; url?: string; body: ReactNode }[] = [
  {
    title: 'Conecte seus bancos no Meu Pluggy',
    url: 'https://meu.pluggy.ai',
    body: <>
      <p>Crie sua conta no Meu Pluggy e conecte cada banco. Cada um pede uma autorização própria, feita no app do banco.</p>
      <p className="muted">É grátis e é por ele que o Yield lê seus dados.</p>
    </>,
  },
  {
    title: 'Crie a conta de desenvolvedor',
    url: 'https://dashboard.pluggy.ai',
    body: <>
      <p>Cadastre-se no dashboard da Pluggy. Isso começa um teste de 15 dias.</p>
      <div className="note">Termine os próximos passos dentro dos 15 dias: depois as conexões continuam lendo, mas não dá mais para adicionar bancos.</div>
    </>,
  },
  {
    title: 'Ligue o conector MeuPluggy',
    body: <>
      <p>No menu da esquerda do dashboard: <b>Dados Financeiros › Customização</b>, aba <b>Conectores</b>.</p>
      <p>Busque <b>MeuPluggy</b>. Ele aparece em <b>Conectores Diretos</b>: deixe a chave ligada e clique em <b>Salvar</b>.</p>
      <p className="muted">Se ele não aparecer no próximo passo, desligue “Padrão para todos selecionados”, ligue o MeuPluggy e salve de novo.</p>
    </>,
  },
  {
    title: 'Conecte o MeuPluggy na Demo',
    body: <>
      <p>Em <b>Visão Geral</b>, no item “Conecte um item demo”, clique em <b>Conectar</b>.</p>
      <p>No widget, escolha <b>MeuPluggy</b>, entre com a conta do Meu Pluggy e autorize. Repita uma vez para cada banco.</p>
    </>,
  },
  {
    title: 'Cole o Client ID e o Client Secret',
    body: <>
      <p>Em <b>Aplicações</b>, abra a sua aplicação e copie o <b>Client ID</b> e o <b>Client Secret</b>.</p>
      <p className="muted">Eles ficam no cofre do sistema e o Yield nunca os mostra de volta. Não compartilhe: eles leem todos os seus dados.</p>
    </>,
  },
  {
    title: 'Adicione cada banco pelo itemId',
    body: <>
      <p>Na Demo, com o banco conectado, abra o menu <b>⋮</b> no canto superior direito e clique em <b>Copiar Item ID</b>.</p>
      <p>Cole aqui com um nome (ex.: Nubank) e repita para cada banco. No fim, clique em <b>Testar conexão</b>.</p>
    </>,
  },
]

const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => {}) }

/** Passo a passo da Pluggy numa janela. `credentials` e `addBank` são os formulários do cartão, mostrados nos passos 5 e 6. */
export function PluggyGuia({ start, done, credentials, addBank, onClose }: {
  start: number; done: boolean[]; credentials: ReactNode; addBank: ReactNode; onClose(): void
}) {
  const [step, setStep] = useState(start)
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const s = STEPS[step]
  const last = step === STEPS.length - 1

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Conectar bancos pela Pluggy" onClick={e => e.stopPropagation()}>
        <div className="bar">
          <b style={{ color: 'var(--strong)' }}>Conectar bancos pela Pluggy</b>
          <button className="b ghost" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="muted" style={{ marginTop: 2 }}>Uns 15 minutos, uma vez só. Webhooks, produção e Pagamentos do dashboard não são necessários.</div>
        <div className="guide">
          <ol className="steps">
            {STEPS.map((x, i) => (
              <li key={x.title}>
                <button className={`step ${i === step ? 'on' : ''} ${done[i] ? 'done' : ''}`} onClick={() => setStep(i)}>
                  <span className="n">{done[i] ? '✓' : i + 1}</span>{x.title}
                </button>
              </li>
            ))}
          </ol>
          <div className="step-body">
            <div className="muted">Passo {step + 1} de {STEPS.length}</div>
            <h3>{s.title}</h3>
            {s.url && (
              <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
                <span className="in" style={{ userSelect: 'all' }}>{s.url}</span>
                <button className="b" onClick={() => { copy(s.url!); setCopied(s.url!) }}>{copied === s.url ? 'Copiado' : 'Copiar link'}</button>
              </div>
            )}
            {s.body}
            {step === 4 && <div style={{ marginTop: 10 }}>{credentials}</div>}
            {step === 5 && <div style={{ marginTop: 10 }}>{addBank}</div>}
            <div className="btns" style={{ marginTop: 14, justifyContent: 'space-between' }}>
              <button className="b" disabled={step === 0} onClick={() => setStep(step - 1)}>Voltar</button>
              {last ? <button className="b pri" onClick={onClose}>Concluir</button> : <button className="b pri" onClick={() => setStep(step + 1)}>Próximo</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
