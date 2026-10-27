# Tela de Categorias nova

## Por quê

A tela atual (`src/pages/Categorias.tsx`) é uma tabela com links "renomear/apagar" e um formulário de regra solto. Ela não segue o visual novo de Lançamentos e Assinaturas, não mostra se o gasto está subindo, não conversa com o Orçamento e, ao apagar uma categoria, as compras dela simplesmente voltam para "sem categoria". O dono do app aprovou um mockup (`.superpowers/brainstorm/…/categorias-v3.html`, não versionado) com o layout abaixo.

## Objetivo

Uma tela que, num olhar, mostra onde o dinheiro do mês foi (por categoria, contra o mês anterior e contra o orçamento) e que deixa organizar categorias e regras sem sair dela.

**Fora de escopo:** reordenar categorias, arrastar e soltar, mudar a lógica de categorização (`categorize`, prioridade override > regra > …), histórico além de comparar com o mês anterior.

**Seria um fracasso se:** os números divergirem do Resumo de gastos para o mesmo mês; apagar uma categoria perder dados sem o usuário ter escolhido; a tela ficar mais lenta que Lançamentos com o banco real (~1.900 lançamentos).

## Layout (aprovado)

Cabeçalho com `GastosHeader` (título "Categorias", navegação de mês, sincronizar/importar) e um botão **Nova categoria** à direita. Abaixo, uma linha: "Gasto do mês **R$ X**" + variação contra o mês anterior ("▲ 6% vs setembro"; verde quando cai, vermelho quando sobe; "igual a setembro" quando 0; nada quando o mês anterior é 0).

Duas colunas (≈1,5fr / 1fr); em telas ≤ 900px viram uma coluna, com o painel da direita **acima** da grade quando está editando/criando (senão abaixo).

### Coluna esquerda

1. **Aviso "sem categoria"** (só se houver gasto sem categoria no mês): "R$ X em N compras sem categoria" + link **Categorizar** → Lançamentos com filtro `categoryId: 'sem'` no mesmo mês.
2. **Grade de blocos**, 3 colunas (2 em telas médias, 1 no celular), só categorias que contam como gasto, ordenadas por valor do mês (desc). Categorias com 0 no mês e 0 no anterior ficam no fim. Cada bloco:
   - ícone (círculo com a cor) + nome; etiqueta "sua" nas criadas pelo usuário;
   - valor do mês e variação vs mês anterior ("▲ 24%", "▼ 18%", "= set"; omitida se o anterior era 0);
   - uma barra + uma legenda:
     - **com orçamento** no mês (soma das linhas de saída do Orçamento daquele mês com essa categoria): barra = gasto/orçamento (máx 100%) na cor da categoria; legenda "82% do orçamento de 1.000,00"; se passou: barra vermelha e "passou 112,90 do orçamento";
     - **sem orçamento**: barra = peso no gasto do mês; legenda "8% do gasto do mês".
   - clicar no bloco → Lançamentos filtrado por essa categoria, no mesmo mês;
   - ao passar o mouse (sempre visível em tela de toque): botão lápis → abre o painel da categoria na coluna direita; o bloco aberto fica com borda verde.
3. **Fora dos gastos**: uma linha de etiquetas com as categorias que não contam como gasto (ícone, nome e o total de saídas no mês, omitido se 0). Clicar numa etiqueta → Lançamentos filtrado; ao passar o mouse, um lápis pequeno dentro da etiqueta abre o painel da categoria (modo "categoria", abaixo).

Os valores vêm das mesmas funções do Resumo (`monthTotals`/`spentByCategory`), para bater.

### Coluna direita — modo "regras" (padrão)

Cartão "Regras" ("a mais específica ganha"):
- **Sugestão de regra** no topo, uma por vez (a de maior contagem): quando o usuário escolheu à mão (override) a **mesma categoria** para compras cujo `suggestRulePattern(descrição)` é igual em **3 ou mais** lançamentos, e não existe regra com esse padrão. Texto: "Academia Forma → Saúde?" + "você escolheu isso à mão N vezes", botões **Não** e **Criar**. *Criar* = `saveRule(padrão, categoria)` e apaga esses overrides (igual ao "fazer isso sempre" de Lançamentos). *Não* = guarda o padrão numa lista de recusadas em `meta` (chave `categorias.sugestoesRecusadas`, JSON de padrões) e não sugere mais.
- Lista de regras: `trecho` → ícone + categoria, "N compras" (quantos lançamentos essa regra **de fato** categoriza hoje, via `ruleFor`), lixeira (apaga na hora, sem confirmação, como hoje).
- Adicionar: campo "descrição contém…", seletor de categoria (a grade com ícones de Lançamentos, `CategoryPicker`, sem o "fazer isso sempre") e **Adicionar**. Enquanto digita (padrão normalizado não vazio), aparece a **prévia**: "Pegaria N compras (M hoje sem categoria)" + até 3 exemplos (nome limpo via `cleanDescription`, data, valor) + "e mais K". "Pegaria" = lançamentos cuja descrição normalizada contém o padrão e que não têm override (override ganha da regra).
- Rodapé: "A categoria escolhida à mão numa compra ganha de todas as regras."

### Coluna direita — modo "categoria" (editar ou criar)

Abre pelo lápis de um bloco/etiqueta ou por **Nova categoria**. Esc ou Cancelar volta ao modo regras.
- Cabeçalho: ícone + nome (ou "Nova categoria").
- **Nome** (validação atual: `validateCategoryName`).
- **Ícone**: grade de ~32 ícones Lucide escolhidos para finanças pessoais (lista fixa em código; inclui os 17 padrão + extras como pets, presente, academia, bebê, jogos, roupa, ferramenta, música, livro, café, etiqueta…).
- **Cor**: 10 cores fixas (as mesmas da paleta já usada em `CategoryIcon`).
- **Conta como gasto**: interruptor, **só para categorias do usuário** (as padrão mostram o estado como texto, sem editar, porque o app trata receita/transferência/fatura/investimento pelo id).
- **Regras desta categoria** (só ao editar): lista igual à geral sem a coluna de categoria, + campo para adicionar com a mesma prévia.
- Rodapé: **Apagar categoria** (só as do usuário), **Cancelar**, **Salvar**.
- **Apagar** troca o rodapé por: "Apagar X? As N compras escolhidas à mão, as R regras e as L linhas do orçamento dela vão para [seletor: outra categoria | Sem categoria]" + **Cancelar** / **Apagar e mover**. Mover = em uma transação: overrides → categoria destino (ou removidos se "sem categoria"); regras → destino (ou removidas); linhas do orçamento → destino (ou `category_id` NULL); depois apaga a categoria.

Salvar fecha o painel e recarrega. Erros aparecem dentro do painel, em pt-BR (padrão `errText`).

## Dados

- **Migração 006** (`006_categoria_visual.sql`): `ALTER TABLE categories ADD COLUMN icon TEXT` e `ADD COLUMN color TEXT` (NULL = usa o padrão do id, ou etiqueta/cinza para as do usuário); `schema_version` 6. Registrar em `lib.rs`, `client.ts` e `testDb.ts`, como a 005. Migrações 003–005 não podem ser editadas.
- `Category` ganha `icon: string | null` e `color: string | null`; `loadGastos` lê as colunas.
- `CategoryIcon` passa a aceitar o ícone/cor salvos (quem tem a `Category` em mãos passa); sem eles, comportamento atual.
- Repositório: `updateCategory(db, id, { name, icon, color, countsAsSpending? })` (substitui `renameCategory`) e `deleteCategory(db, id, moveTo: string | null)` com a transação acima. O backup já leva a tabela inteira; a validação de versão do backup sobe para 6 como nas vezes anteriores.
- Recusas de sugestão: `meta` (`categorias.sugestoesRecusadas`), lidas em `loadGastos` como `ruleSuggestionsDismissed: string[]`.
- Orçamento por categoria/mês: vem de `orcamento.data.lines` (já no `DataProvider`), filtrando `month`, `kind === 'saida'` e `categoryId`.

## Navegação

`Categorias` recebe `onOpenLancamentos()` (como Assinaturas); antes de chamar, faz `setMonth(mês da tela)` e `setFilter({ ...NO_FILTER, categoryId })`.

## Testes

Lógica pura em `src/pages/categorias/build.ts` com testes: variação vs mês anterior, orçamento por categoria e legenda (dentro/passou), sugestões de regra (limite de 3, recusadas, padrão já existente), prévia de regra (respeita overrides), contagem por regra. Repositório: `deleteCategory` movendo overrides/regras/linhas do orçamento, nos dois casos (destino e "sem categoria"); migração 006 no teste de versão do backup. Sem testes de UI (padrão do projeto). Fixtures sempre inventadas (o repositório é público).

## Decisões tomadas na revisão (do autor, não do dono do app)

- **Categorias padrão** podem mudar nome, ícone e cor (renomear já era permitido); só "conta como gasto" e apagar ficam travados. Ícone/cor salvos têm precedência sobre o padrão por id.
- **"Sem categoria" não vira bloco na grade**: aparece só no aviso do topo.
- **Sugestões de regra** olham o histórico inteiro (todos os overrides cujo fingerprint ainda tem lançamento), não só o mês da tela.
- **Apagar movendo para "Sem categoria"** remove os overrides: essas compras voltam para regra, categoria da Pluggy ou heurística (o mesmo que acontece hoje). A mensagem diz isso ("voltam para a categoria automática"), reaproveitando `deleteImpact` para as contagens.
- **Ícone** é salvo como o nome Lucide em kebab-case (`paw-print`), resolvido por um mapa nome→componente fixo em código (mantém o tree-shaking); nome desconhecido cai na etiqueta. **Cores**: 10 fixas — `#ff9f5a #f5d76e #6fdc8c #4fd1a5 #7fd1d1 #5fb3ff #9aa8ff #c79bff #ff8fd0 #ff7a8a` — mais o cinza `#9a9da6`; as cores padrão das categorias que não estão nessa lista continuam valendo enquanto o usuário não trocar.
- **Orçamento** só conta se existir linha de saída daquele mês com a categoria; sem linha no mês = "sem orçamento" (barra de peso). Não herda de meses anteriores.

## Decidido pelo construtor

Nomes de componentes/arquivos, a lista exata dos ~32 ícones, espaçamentos e o CSS (seguindo os tokens e classes já usados em Lançamentos/Assinaturas: `cat-ico`, `day-card`, `icon-btn`, `b danger` etc.).
