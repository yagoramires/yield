# Tela de Categorias nova — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a tela de Categorias por grade de blocos (valor, variação, orçamento) + coluna direita que alterna entre Regras e o painel da categoria, com ícone/cor salvos, apagar movendo e sugestões/prévia de regra.

**Architecture:** Migração 006 (ícone/cor) e funções novas em `gastosRepo`; lógica pura em `src/pages/categorias/build.ts`; `CategoryIcon` passa a receber a `Category`; a página vira `Categorias.tsx` + `categorias/RegrasPanel.tsx` + `categorias/CategoriaPanel.tsx`.

**Tech Stack:** React 19 + TS, Vitest (node:sqlite via `createTestDb`), Tauri 2 + tauri-plugin-sql, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-27-categorias-tela-nova-design.md`

## Global Constraints

- Repositório público: fixtures e exemplos sempre inventados (nada dos dados do dono).
- Migrações 001–005 não podem ser editadas; tudo novo vai na 006.
- Dinheiro em centavos inteiros; mês `'YYYY-MM'`.
- Textos em pt-BR; nunca `window.confirm/alert/prompt`.
- Commits sem `Co-Authored-By` e sem rodapé do Claude.
- Números do mês vêm de `monthTotals`/`spentByCategory` (batem com o Resumo).

## Review Focus

1. Categoria do usuário com `icon` salvo que não existe no mapa → etiqueta, sem quebrar (teste na Task 2).
2. Mês anterior com gasto 0 → variação omitida, não "Infinity%" (teste na Task 3).
3. Padrão de regra que normaliza para vazio ("123", "*") → sem prévia e sem sugestão (testes na Task 3).
4. Apagar categoria com regra cujo destino já tem a mesma regra → `pattern` é UNIQUE e só muda `category_id`, sem conflito (teste na Task 1).
5. Linhas do orçamento da categoria apagada sem destino → `category_id` NULL, linha preservada (teste na Task 1).

---

### Task 1: Banco — migração 006, ícone/cor, editar, apagar movendo, recusas de sugestão

**Files:**
- Create: `src-tauri/migrations/006_categoria_visual.sql`
- Modify: `src-tauri/src/lib.rs` (registro version 6), `src/db/client.ts` (`SCHEMA_VERSION = 6`), `src/db/testDb.ts` (lista de migrações), `src/db/gastosRepo.ts`
- Test: `src/db/gastosRepo.test.ts`; trocar `'5'` por `'6'` nas asserções de versão em `src/db/gastosRepo.test.ts`, `src/db/orcamentoRepo.test.ts`, `src/db/backup.test.ts`; acrescentar `ruleSuggestionsDismissed: []` onde houver literal de `GastosData` nos testes.

**Interfaces — Produces:**
- `Category` ganha `icon: string | null; color: string | null`.
- `GastosData` ganha `ruleSuggestionsDismissed: string[]` (meta `categorias.sugestoesRecusadas`, JSON).
- `saveCategory(db, name, countsAsSpending, look?: { icon: string | null; color: string | null }): Promise<string>`
- `updateCategory(db, id, f: { name: string; icon: string | null; color: string | null; countsAsSpending: boolean }): Promise<void>` — `counts_as_spending` só muda quando `builtin = 0`. Substitui `renameCategory` (remover e ajustar quem usa).
- `deleteCategory(db, id, moveTo: string | null): Promise<void>` — recusa builtin (mensagem atual); se `moveTo`: `UPDATE category_overrides`, `UPDATE category_rules`, `UPDATE budget_lines SET category_id = moveTo` da categoria; senão `DELETE` overrides/regras e `budget_lines.category_id = NULL` (o FK já faz SET NULL). Depois `DELETE FROM categories`. Sem transação (o plugin não tem): mover antes de apagar, para uma falha no meio não perder nada.
- `dismissRuleSuggestion(db, pattern: string): Promise<void>` — acrescenta ao JSON sem repetir.

- [ ] **Step 1: Testes que falham** em `gastosRepo.test.ts`:
  - `updateCategory grava nome, ícone e cor; conta-como-gasto só muda nas do usuário`: `updateCategory(db,'lazer',{name:'Diversão',icon:'gamepad-2',color:'#ff8fd0',countsAsSpending:false})` → categoria `lazer` com esses nome/ícone/cor e `countsAsSpending` ainda `true`; numa criada por `saveCategory` o mesmo update deixa `countsAsSpending` `false`.
  - `deleteCategory move compras, regras e orçamento para outra categoria`: criar `Pets`, `saveRule('petz', pets)`, `saveRule('racao', 'outros')`, `setOverride('fp-1', pets)`, uma linha de orçamento de saída com `categoryId: pets` (via `orcamentoRepo`); `deleteCategory(db, pets, 'outros')` → overrides `{ 'fp-1': 'outros' }`, regra `petz` com `categoryId 'outros'`, linha do orçamento com `categoryId 'outros'`.
  - `deleteCategory sem destino tira as escolhas e deixa a linha do orçamento sem categoria`: overrides `{}`, regras sem `petz`, linha preservada com `categoryId null`.
  - `recusa de sugestão vai para o meta sem repetir`: `dismissRuleSuggestion` duas vezes com `'padaria sol'` → `ruleSuggestionsDismissed` `['padaria sol']`.
  - Ajustar o teste antigo de `deleteCategory` para a assinatura nova (`deleteCategory(db, id, null)`) e `renameCategory` → `updateCategory`.
- [ ] **Step 2:** `npx vitest run src/db` → FAIL (funções/colunas inexistentes).
- [ ] **Step 3:** Migração `006_categoria_visual.sql`: `ALTER TABLE categories ADD COLUMN icon TEXT;`, `ALTER TABLE categories ADD COLUMN color TEXT;`, `UPDATE meta SET value = '6' WHERE key = 'schema_version';`. Registrar (lib.rs `version: 6, description: "visual das categorias"`), `SCHEMA_VERSION = 6`, `testDb.ts`. Implementar as funções acima; `loadGastos` lê `icon, color` e o meta novo.
- [ ] **Step 4:** `npx vitest run` → tudo PASS; `npx tsc --noEmit -p .` limpo (ajustar chamadas de `renameCategory`/`deleteCategory` só o suficiente para compilar; a tela é reescrita na Task 4).
- [ ] **Step 5:** `git commit -m "feat: categorias com ícone e cor salvos e apagar movendo as compras"`

### Task 2: `CategoryIcon` usa o ícone/cor salvos

**Files:** Modify `src/ui/CategoryIcon.tsx`, `src/pages/Lancamentos.tsx`, `src/pages/lancamentos/CategoryPicker.tsx`; Test: `src/ui/CategoryIcon.test.ts` (só a função pura).

**Interfaces — Produces:**
- `ICON_CHOICES: string[]` — ~32 nomes Lucide kebab-case (os 17 padrão + `paw-print gift baby dumbbell gamepad-2 shirt wrench music book-open coffee store apple carrot wine package sparkles tag`…), cada um no mapa nome→componente.
- `COLOR_CHOICES = ['#ff9f5a','#f5d76e','#6fdc8c','#4fd1a5','#7fd1d1','#5fb3ff','#9aa8ff','#c79bff','#ff8fd0','#ff7a8a','#9a9da6']`
- `categoryLook(c: Pick<Category,'id'|'icon'|'color'> | null): { icon: string; color: string }` — salvo > padrão do id > `tag`/`#9a9da6`; `null` = sem categoria (`circle-help`, `#ffcf5c`); ícone salvo desconhecido → `tag`.
- `CategoryIcon({ category, size?, bare? })` — `category: Pick<Category,'id'|'icon'|'color'> | null` no lugar de `id`.

- [ ] **Step 1:** Teste `categoryLook`: padrão (`{id:'mercado',icon:null,color:null}` → `{icon:'shopping-cart',color:'#6fdc8c'}`), salvo vence (`{id:'mercado',icon:'store',color:'#ff7a8a'}`), desconhecido (`{id:'x',icon:'nao-existe',color:null}` → `{icon:'tag',color:'#9a9da6'}`), `null` → `{icon:'circle-help',color:'#ffcf5c'}`.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar e trocar os 3 usos (na faixa de Lançamentos, achar a `Category` em `data.categories` pelo `i.id`). **Step 4:** `npx vitest run` + `tsc` limpos.
- [ ] **Step 5:** `git commit -m "feat: ícone da categoria respeita o ícone e a cor escolhidos"`

### Task 3: Lógica pura da tela (`src/pages/categorias/build.ts`)

**Interfaces — Produces:**
- `monthDelta(cur: Cents, prev: Cents): number | null` — `null` se `prev === 0`; senão `Math.round((cur - prev) / prev * 100)`.
- `budgetByCategory(lines: BudgetLine[], month: Month): Map<string, Cents>` — soma linhas `kind === 'saida'` do mês com `categoryId`.
- `ruleUsage(txns: Txn[], rules: CategoryRule[], overrides: Record<string,string>): Map<string, number>` — por `ruleFor`.
- `rulePreview(pattern: string, txns: Txn[], overrides: Record<string,string>, cat: (t: Txn) => Category | null): { count: number; uncategorized: number; examples: Txn[] } | null` — `null` se `normalizeDescription(pattern)` vazio; conta lançamentos sem override cuja descrição normalizada contém o padrão; `uncategorized` = desses, `cat(t) === null`; `examples` = 3 mais recentes.
- `ruleSuggestions(txns: Txn[], overrides: Record<string,string>, rules: CategoryRule[], dismissed: string[]): { pattern: string; categoryId: string; count: number }[]` — agrupa overrides por `suggestRulePattern(descrição)` (pula vazio, padrão que já é regra e recusados); por padrão, a categoria com mais escolhas; só `count >= 3`; ordem por `count` desc.

- [ ] **Step 1:** Testes em `build.test.ts` com txns inventados: `monthDelta(120,100)=20`, `monthDelta(80,100)=-20`, `monthDelta(5,0)=null`; orçamento soma duas linhas do mês e ignora outro mês/entrada/sem categoria; `ruleUsage` conta só onde a regra realmente vence (override ganha); `rulePreview('123',…)=null`, prévia ignora lançamento com override e conta `uncategorized`; `ruleSuggestions` com 3 overrides `'padaria sol'`→alimentacao vira sugestão `count 3`, 2 não viram, padrão recusado some, padrão já regra some.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. **Step 5:** `git commit -m "feat: variação, orçamento, prévia e sugestões de regra das categorias"`

### Task 4: A tela

**Files:** Rewrite `src/pages/Categorias.tsx`; Create `src/pages/categorias/RegrasPanel.tsx`, `src/pages/categorias/CategoriaPanel.tsx`; Modify `src/App.tsx` (passar `onOpenLancamentos`), `src/theme.css`.

**Interfaces — Consumes:** Tasks 1–3; `CategoryPicker` (sem o "fazer sempre": tornar `pattern` opcional/vazio já esconde), `GastosHeader`, `spentByCategory`, `monthTotals`, `cleanDescription`, `NO_FILTER`, `useData().orcamento.data.lines`.

Comportamento exatamente como a seção "Layout" do spec. Estado da coluna direita: `{ mode: 'regras' } | { mode: 'editar', id } | { mode: 'criar' }`. Em ≤ 900px uma coluna; painel em edição/criação vem antes da grade.

- [ ] **Step 1:** Implementar; reaproveitar classes existentes (`kpis`/`cat-ico`/`icon-btn`/`b danger`/`day-card`) e criar só o que faltar (`cat-tiles`, `cat-tile`, `cat-tile.picked`, `fora-chips`, `rules-card`, `cat-panel`).
- [ ] **Step 2:** `tsc` + `vitest` limpos.
- [ ] **Step 3:** Conferência visual com página de teste temporária (`harness/`, vite + playwright, `DataProvider` mockado com dados inventados), desktop 1200px e celular 390px: dia a dia, editando, criando, apagar com "mover para", prévia e sugestão. Apagar `harness/` depois.
- [ ] **Step 4:** `git commit -m "feat: tela de Categorias nova"`

### Task 5: Fechamento

- [ ] Varrer o diff contra dados reais (nomes, finais de conta, descrições do dono) — zero ocorrências.
- [ ] Build assinado local (`APPLE_SIGNING_IDENTITY` = hash do "Yield Local", chaves do updater do Keychain) e instalar em `/Applications`.
- [ ] Revisão final da branch por um revisor novo.
