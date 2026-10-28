# Carteira por classes e Resumo com tudo junto — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carteira com classes à esquerda e posições da classe à direita (direção C), e Resumo de investimentos com a faixa de 5 blocos, aportado bolsa + renda fixa por mês e juros da renda fixa na renda passiva.

**Architecture:** Só apresentação: `buildPortfolio`/`rfHoldings` continuam a fonte. Funções puras novas agrupam o `Portfolio` em classes (`src/pages/carteira/build.ts`) e em blocos do Resumo (`src/pages/resumoInvestimentos/build.ts`); uma função de domínio calcula o aplicado em renda fixa por mês. A Carteira vira `ClassList` + painel da classe.

**Tech Stack:** React 19 + TS, Vitest, lucide-react; sem migração.

**Spec:** `docs/superpowers/specs/2026-10-28-carteira-classes-design.md`

## Global Constraints

- Nenhum valor muda em relação à 0.4.0; ações existentes da Carteira continuam (preço manual, remover preço manual, ativo manual criar/editar/excluir, ver encerrados, ↻ Binance, informar aportado de cripto, avisos de duplicidade, aviso do câmbio, estado vazio).
- Repositório público: testes com dados inventados (AAAA3, FIIA11, ZZZZ, Banco Laranja). Commits sem Co-Authored-By.
- Visual das telas novas (`card`, `kpis`, `sum-row`, lucide-react, `classColor`), tabular-nums; ≤ 900px empilha via CSS. Olhinho (`useHideValues`) no Resumo, inclusive nos blocos.
- Comandos: `npx vitest run <arquivo>`, `npx tsc --noEmit -p .`.

## Review Focus

1. Classe que existe só em ativos manuais (ex. Dólar) ou só sem cotação → aparece na lista, sem quebrar o % (patrimônio 0 não divide por zero). (Task 2)
2. Clique em bloco do Resumo para classe vazia → Carteira abre na maior. (Task 2)
3. Mês sem nenhuma movimentação de renda fixa → aplicado 0, não negativo; venda maior que o comprado não deixa aplicado negativo. (Task 1)
4. Resultado da Carteira e do Resumo iguais para o mesmo `Portfolio`. (Task 1)
5. Olhinho ligado esconde os valores dos blocos novos do Resumo. (Task 4, verificação visual)

---

### Task 1: Cálculos compartilhados (resultado e renda fixa por mês)

**Files:** Modify `src/domain/portfolio.ts`, `src/domain/portfolio.test.ts`, `src/domain/rendaFixa.ts`, `src/domain/rendaFixa.test.ts`, `src/pages/Carteira.tsx`, `src/pages/ResumoInvestimentos.tsx`

**Interfaces — Produces:**
- `portfolioResult(p: Portfolio): { gainCents: Cents; baseCents: Cents }` — renda variável cotada (`varCents`/`costCents` das linhas com valor) + `otherGainCents`/`otherCostCents`.
- `rfAppliedByMonth(moves: RfMove[], lastMonth: Month, n: number): { month: Month; cents: Cents }[]` — para o fim de cada mês, soma do aplicado em aberto por custo médio (aplicação soma; saída tira a parte proporcional à quantidade, nunca abaixo de 0; juros não entram).

- [ ] Testes: `portfolioResult` com 1 ação cotada (custo 1000, valor 1200) + `otherGainCents 100`/`otherCostCents 500` → `{ gainCents: 300, baseCents: 1500 }`; `rfAppliedByMonth` com aplicação de 1000 em 2026-08 (qty 10), venda de 4 em 2026-09, juros em 2026-10, n=4 até 2026-10 → `[0, 1000, 600, 600]`; venda maior que o comprado → 0.
- [ ] FAIL → implementar → PASS; trocar as contas duplicadas de Carteira e Resumo por `portfolioResult`.
- [ ] Commit `refactor: resultado da carteira num cálculo só e renda fixa aplicada por mês`.

### Task 2: Classes da Carteira (função pura)

**Files:** Create `src/pages/carteira/build.ts`, `src/pages/carteira/build.test.ts`

**Interfaces — Produces:**
- `type ClassKey = AssetType | ManualAsset['assetClass']` (Ação, FII, ETF, BDR, renda_fixa, exterior, cripto, dolar, outro).
- `interface ClassSummary { key: ClassKey; label: string; valueCents: Cents; pct: number; gainCents: Cents | null; gainPct: number | null; usdGain: boolean /* exterior: % em US$ */; count: number; missingQuotes: number }`
- `carteiraClasses(p: Portfolio): ClassSummary[]` — ordem de valor desc; inclui classe com itens mesmo sem valor (só sem cotação); renda fixa = títulos abertos da B3 + manuais `renda_fixa`; cripto = Binance + manuais `cripto`; exterior com ganho em US$ (soma `usdCents − usdCostCents` ÷ `usdCostCents` dos que têm aportado); `gainCents/gainPct` null quando nenhum item da classe tem custo; `pct` 0 quando o patrimônio é 0.
- `pickClass(list: ClassSummary[], wanted: string | null): ClassKey | null` — `wanted` se existir com itens; `'bolsa'` → a maior entre Ação/FII/ETF/BDR; senão a primeira (maior).

- [ ] Testes com `Portfolio` montado à mão: ordem por valor; Dólar só manual aparece; FII só sem cotação aparece com `missingQuotes 1` e `valueCents 0`; patrimônio 0 → pct 0; `pickClass(list, 'bolsa')`, `pickClass(list, 'cripto')` sem cripto → maior.
- [ ] FAIL → implementar → PASS.
- [ ] Commit `feat: classes da carteira`.

### Task 3: Tela da Carteira (direção C)

**Files:** Modify `src/pages/Carteira.tsx`, `src/pages/carteira/RendaFixa.tsx`, `src/pages/carteira/Cripto.tsx`, `src/theme.css`, `src/App.tsx`; Create `src/pages/carteira/ClassList.tsx`

**Interfaces — Consumes:** Task 1 e 2. **Produces:** `Carteira({ onOpenSettings, initialClass }: { onOpenSettings(): void; initialClass?: string | null })`; `App` guarda `carteiraClass` e monta `<Carteira key={carteiraClass ?? ''} initialClass={carteiraClass} …/>`.

Comportamento (spec §1): cabeçalho; 4 números (Patrimônio + aportado; Resultado via `portfolioResult`; Proventos + juros 12 meses; Sem aportado); `.cart-cols` (300px | 1fr, empilha ≤ 900px) com `ClassList` à esquerda e o painel da classe à direita. Painel: título (nº itens, total, resultado); linhas no grid único (avatar, nome + detalhe, valor + % da classe, resultado, custo/aplicado/aportado) para renda variável (com preço manual/remover), manuais (editar/excluir, US$ no exterior com o aviso do câmbio no rodapé), e as classes Renda fixa e Cripto reaproveitando `RendaFixa`/`Cripto` reescritos no mesmo grid (sem os títulos h5 próprios). Avisos de duplicidade no topo da classe. Formulário de ativo manual abre pelo "+ Ativo" acima do painel. A tabela antiga e os chips agrupar/lista saem. Estado vazio igual ao atual.

- [ ] `npx tsc --noEmit -p .` e `npx vitest run` → PASS.
- [ ] Ver no harness (navegador, `DataProvider` falso com dados inventados): 8 classes, troca de classe, renda fixa com encerrados, cripto, exterior com US$, largura 800px empilhando.
- [ ] Commit `feat: carteira com classes à esquerda e posições à direita`.

### Task 4: Resumo de investimentos

**Files:** Modify `src/pages/ResumoInvestimentos.tsx`, `src/pages/resumoInvestimentos/build.ts`, `src/pages/resumoInvestimentos/build.test.ts`, `src/theme.css`, `src/App.tsx`

**Interfaces — Produces:**
- `moneyBuckets(p: Portfolio): { key: 'bolsa' | 'renda_fixa' | 'exterior' | 'cripto' | 'dolar'; label: string; valueCents: Cents; pct: number; gainCents: Cents | null; gainPct: number | null; usdGain: boolean; note: string }[]` — só os com valor > 0; Bolsa = Ação+FII+ETF+BDR; notas: "ações, FIIs, ETFs, BDRs" / "N títulos" / "US$ x" / "Binance, hh:mm" (sem horário se não houver Binance) / "dólar R$ x".
- `ResumoInvestimentos` ganha `onOpenCarteira(cls?: string)`.

Comportamento (spec §2): faixa `.buckets` (5 colunas; 2 em ≤ 900px) abaixo dos números, clique abre a Carteira na classe; "Aportado × valor de hoje" com duas linhas — bolsa e bolsa + renda fixa (`investedByMonth` + `rfAppliedByMonth`) — e o ponto de hoje com o patrimônio inteiro, legenda dizendo isso; Renda passiva com a barra dividida (proventos | juros) e o texto "proventos R$ x/mês · juros da renda fixa R$ y/mês · gasto R$ z/mês · faltam …". Valores pelo `brl/cents/short` do olhinho.

- [ ] Testes de `moneyBuckets`: Bolsa soma as 4 classes; cripto sem Binance não mostra horário; classe sem valor some; exterior com `usdGain`.
- [ ] FAIL → implementar → PASS; tsc limpo.
- [ ] Ver no harness com olhinho ligado e desligado.
- [ ] Commit `feat: resumo com onde está seu dinheiro, renda fixa no aportado e juros na renda passiva`.

### Task 5: Fechamento

- [ ] CHANGELOG "Próxima versão" (Carteira nova, Resumo com tudo junto, assinatura pendente não fica atrasada). README: linha da Carteira/Resumo.
- [ ] `npx vitest run` + tsc → PASS. Commit `docs: carteira por classes e resumo no changelog`.
