import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AiInput } from '../../ai/facts'
import { addMonths, monthOf } from '../../domain/money'
import { rentOver } from '../../domain/rentabilidade'
import type { Month } from '../../domain/types'
import { todayISO, useData } from '../../state/DataProvider'
import { histTickers, loadHist } from '../resumoInvestimentos/Rentabilidade'

/**
 * Os dados do app no formato que a IA lê; `rent` só no mês atual (é o retrato de hoje) e `null` se o histórico não veio.
 * `withRent: false` (chat, Orçamento) não espera o histórico de cotações: o chat busca pela ferramenta quando precisa.
 */
export function useAiInput(month: Month, withRent = true): { input: AiInput | null; loadRent(meses: number): Promise<AiInput['rent']> } {
  const { data, derived, gastos, orcamento } = useData()
  const today = todayISO()
  const thisMonth = monthOf(today)
  // ETF de renda fixa fora, como no Resumo de investimentos
  const trades = useMemo(() => data.trades.filter(t => t.assetType !== 'ETF RF'), [data.trades])
  const loadRent = useCallback(async (meses: number) => {
    try {
      const hist = await loadHist(histTickers(trades, data.events), addMonths(thisMonth, -meses), thisMonth)
      return rentOver(trades, data.events, data.dividends, hist, thisMonth, meses)
    } catch { return null }
  }, [trades, data.events, data.dividends, thisMonth])
  const [rent, setRent] = useState<AiInput['rent'] | undefined>(undefined)
  useEffect(() => {
    let alive = true
    if (month !== thisMonth || !withRent) setRent(null)
    else { setRent(undefined); loadRent(12).then(r => alive && setRent(r)) }
    return () => { alive = false }
  }, [month, thisMonth, loadRent, withRent])
  const input = useMemo<AiInput | null>(() => (rent === undefined ? null : {
    today, gastos: { data: gastos.data, categorize: gastos.categorize, subscriptions: gastos.subscriptions },
    orcamento: orcamento.data, portfolio: derived.portfolio, dividends: data.dividends, rfMoves: data.rfMoves, rent,
  }), [rent, today, gastos.data, gastos.categorize, gastos.subscriptions, orcamento.data, derived.portfolio, data.dividends, data.rfMoves])
  return { input, loadRent }
}
