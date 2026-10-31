import { Sparkles } from 'lucide-react'
import { setAiSettings } from '../../ai/settings'

/** Na primeira abertura (inclusive de quem atualizou): a pessoa escolhe se quer usar IA. Dá para mudar em Configurações › IA local. */
export function AiPergunta({ onUse }: { onUse(): void }) {
  return (
    <div className="modal-bg">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ai-pergunta" style={{ width: 'min(480px, 100%)' }}>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}><Sparkles size={16} aria-hidden /><b id="ai-pergunta" style={{ color: 'var(--strong)' }}>Quer usar o Assistente com IA?</b></div>
        <p className="muted" style={{ margin: '8px 0' }}>
          Uma IA que roda neste computador lê os números do app, aponta o que importa nos seus gastos e investimentos e responde perguntas sobre os seus dados.
          Nenhum dado financeiro sai daqui.
        </p>
        <p className="muted" style={{ margin: '0 0 12px' }}>Só quando você ativar no Assistente o app baixa o modelo (de 2,5 a 5 GB, uma vez só). Dá para mudar depois em Configurações › IA local.</p>
        <div className="btns">
          <button className="b pri" autoFocus onClick={() => { setAiSettings({ off: false }); onUse() }}>Usar o Assistente</button>
          <button className="b ghost" onClick={() => setAiSettings({ off: true })}>Agora não</button>
        </div>
      </div>
    </div>
  )
}
