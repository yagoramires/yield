import { useState } from 'react'
import { saveProventosMode, type ProventosMode } from '../../db/repo'
import { useData } from '../../state/DataProvider'
import { errText } from '../lancamentos/GastosHeader'

/** O que a pessoa faz com os proventos: decide se eles pagam as próximas compras (não saem do bolso) no Resumo de investimentos. */
export function Proventos() {
  const { db, data, reload } = useData()
  const [error, setError] = useState<string | null>(null)
  const pick = async (mode: ProventosMode) => {
    try { await saveProventosMode(db, mode); await reload(); setError(null) } catch (e) { setError(`Não foi possível salvar: ${errText(e)}`) }
  }
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="bar">
        <h5 style={{ margin: 0 }}>Proventos <span className="muted">· para o Resumo de investimentos</span></h5>
        <div className="seg" role="group" aria-label="O que você faz com os proventos">
          {([['reinvisto', 'Reinvisto'], ['saco', 'Saco da corretora']] as const).map(([m, l]) => (
            <button key={m} className={data.proventos === m ? 'on' : ''} aria-pressed={data.proventos === m} onClick={() => void pick(m)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="muted" style={{ marginTop: 6 }}>
        {data.proventos === 'reinvisto'
          ? 'Cada provento entra numa caixinha e as próximas compras usam primeiro o que tem nela: só o resto conta como dinheiro do seu bolso.'
          : 'Os proventos não pagam compras: tudo que você comprou conta como dinheiro do seu bolso.'} Em qualquer caso, o resultado soma os proventos recebidos.
      </div>
      {error && <div className="note" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  )
}
