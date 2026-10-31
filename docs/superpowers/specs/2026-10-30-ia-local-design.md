# Assistente com IA local (insights + chat)

## Por quê

O Yield já calcula muito (gastos por categoria, orçamento, rentabilidade × CDI/Ibovespa, proventos, assinaturas), mas o usuário ainda tem que olhar tela por tela e tirar as conclusões sozinho. O pedido: "mais insights de gastos, investimentos, se tá rendendo bem, se tá gastando muito". A ideia é ter uma IA que lê os números do app e diz em português o que importa, e que também responde perguntas livres. Tudo **local**, como o resto do app: sem conta, e nenhum dado financeiro sai da máquina.

## Objetivo

1. **Insights do mês:** ao abrir o Assistente, de 3 a 6 observações curtas sobre o mês escolhido, cada uma com uma recomendação quando fizer sentido. Exemplos: "delivery subiu 30% em relação a setembro, corte X para voltar ao orçamento"; "a carteira rendeu abaixo do CDI nos últimos 12 meses"; "R$ x parado na conta corrente renderia ~R$ y/mês a 100% do CDI".
2. **Chat:** um campo para perguntas livres sobre os dados ("quanto gastei com mercado este ano?", "meus FIIs estão rendendo bem?").
3. **Modelo escolhido pelo hardware de quem usa** (Mac e Windows), baixado no primeiro uso.

**Fora de escopo (v1):** histórico de chat salvo entre sessões; a IA criar, editar ou apagar dados (ela só lê); indicar ativo específico para comprar ou vender (ticker); voz; uso de IA na nuvem; treinar o modelo (fica como fase opcional, ver §7).

**Seria um fracasso se:**
- a IA mostrar um número que não saiu do banco do app (valor inventado ou conta errada feita por ela);
- algum dado financeiro sair da máquina (a única rede nova permitida é o download do modelo);
- o app ficar mais lento ou pesado para quem não usa o Assistente (nada carrega até a pessoa ativar);
- o servidor do modelo puder ser usado por outro programa da máquina;
- dado real entrar no repositório (repo público).

## Restrições

- Repositório público: testes e bateria de avaliação usam dados inventados (AAAA3, Banco Laranja…). Commits sem Co-Authored-By.
- Visual das telas novas: `card`, `sum-row`, `kpis`, `Select`, lucide-react, tabular-nums. Sem `window.confirm`; ações destrutivas pedem confirmação na própria tela.
- Esquema do banco: só migrações novas (017+; a 016 é o saldo das contas), nunca editar as existentes.
- Open Finance continua só leitura. A IA também é só leitura: nenhuma ferramenta dela escreve no banco.
- Hardware de referência do autor: Apple M5, 16 GB. Precisa funcionar também em Windows x64 (com e sem GPU).

## 1. Princípio: o app faz as contas, a IA só escreve

Todo número que a IA cita vem de uma função de domínio já existente (ou de uma nova, pura e testada). O modelo recebe esses números prontos e só escolhe o que é relevante e explica.

- **Insights:** uma função nova `buildFacts(month, data)` em `src/domain/insights.ts` monta uma lista de fatos estruturados (JSON) a partir dos builders que os Resumos já usam: `monthTotals`, `comparePreviousMonth`, `biggestChanges`, `monthForecast` × planejado (`spendingPlan`/`goalsFor`), `topSpending`, `nextCharges`, `portfolioResult`, rentabilidade × CDI/Ibovespa, `passiveCoverage`, saldo parado em conta corrente (`accounts.balanceCents` das contas `kind = conta` vindas da Pluggy, com a data `balanceAt`; conta por arquivo não tem saldo e fica de fora) × rendimento a 100% do CDI. Cada fato tem `id`, tipo, valores em centavos e o texto de contexto mínimo. O modelo devolve JSON (`[{factIds, titulo, texto, recomendacao?}]`). O app **descarta** qualquer insight que cite fato inexistente ou que tenha um valor monetário no texto que não esteja nos fatos citados (conferência por regex de `R$` e `%` contra os valores formatados).
- **Chat:** o modelo usa **ferramentas** (tool calling) que chamam o domínio e devolvem números prontos. Conjunto mínimo:
  - `gastos(de, ate, categoria?)`: total e por categoria;
  - `lancamentos(de, ate, busca?, categoria?)`: no máximo 30 linhas, mais o total;
  - `orcamento(mes)`: planejado × realizado por bloco;
  - `carteira()`: patrimônio, por classe, resultado;
  - `rentabilidade(periodo)`: carteira × CDI × Ibovespa;
  - `proventos(de, ate)`.
  As ferramentas fazem as somas, então o modelo não precisa somar nada. A resposta do chat passa pela mesma conferência de valores; se citar valor que não veio de nenhuma ferramenta da conversa, aparece um aviso "valor não conferido" ao lado.

## 2. Recomendações

A IA pode recomendar ações (pedido do usuário): cortar ou reduzir um gasto, rever assinatura, voltar ao orçamento, montar reserva, tirar dinheiro parado da conta corrente, rebalancear entre classes. As recomendações ficam no nível de **classe** (ex.: "renda fixa atrelada ao CDI", "Tesouro Selic"), nunca um ticker ou produto específico. Rodapé fixo e discreto no Assistente: "Sugestões automáticas a partir dos seus dados; não são recomendação de investimento."

## 3. Motor local

- **llama.cpp (`llama-server`) como sidecar do Tauri**, uma versão fixa, empacotada no instalador: macOS universal (Metal) e Windows x64 (Vulkan, com fallback para CPU). Fala a API compatível com OpenAI em `127.0.0.1`, numa porta aleatória, com `--api-key` gerada a cada início (o app guarda só em memória). É o que impede outro programa da máquina de usar o servidor.
- Sobe **só quando o Assistente é aberto** e desliga após 10 min sem uso ou ao fechar o app (um modelo de 8B ocupa ~6 GB de RAM).
- **Modelo baixado no primeiro uso**, do Hugging Face, para a pasta de dados do app (`…/com.yagoramires.yield/models/`), com progresso, retomada e conferência de SHA-256. É a única rede nova; entra na allowlist só o host do download. Remover o modelo em Configurações apaga o arquivo.
- **Catálogo de modelos** num JSON versionado no app (`src/ai/catalog.json`): nome, URL, SHA-256, tamanho, RAM mínima, janela de contexto. Trocar de modelo numa versão nova do app é só mudar esse arquivo.

## 4. Escolha pelo hardware

Comando Rust novo `ai_hardware()` devolve RAM total, arquitetura, SO e (Windows) se há GPU Vulkan com VRAM. Faixas iniciais (os modelos exatos saem da avaliação da §7):

| Máquina | Faixa | Candidatos (GGUF Q4_K_M) |
|---|---|---|
| Mac Apple Silicon ≥ 16 GB; PC com GPU ≥ 8 GB VRAM ou ≥ 16 GB RAM | média | ~8B (Qwen3 8B) |
| 8–15 GB | leve | ~4B (Qwen3 4B) |
| < 8 GB, ou Mac Intel | indisponível | Assistente mostra o motivo; o resto do app segue normal |

Depois do download roda uma **calibração** curta (gera ~100 tokens): abaixo de ~8 tokens/s, sugere o modelo da faixa abaixo. A pessoa sempre pode trocar manualmente em Configurações.

## 5. Telas

- **Sidebar:** grupo novo "Assistente" com um item (rota `assistente`).
- **Assistente:** cabeçalho com seletor de mês (o mesmo padrão dos Resumos) e o olhinho. Em cima, os **insights do mês** em cards (título, texto, recomendação destacada, link "ver" para a tela de origem, ex.: Lançamentos filtrado pela categoria). Embaixo, o **chat** (respostas em streaming, botão parar, "nova conversa"). Sem modelo instalado: um card explica, mostra a máquina detectada e o modelo recomendado (nome, tamanho) e tem o botão "Baixar e ativar".
- **Insights em cache:** tabela nova (migração 017) `ai_insights(month, facts_hash, model, json, created_at)`. Se os fatos do mês não mudaram, mostra o que está salvo; se mudaram, mostra o salvo marcado "desatualizado" e um botão "gerar de novo" (não regera sozinho, porque leva de 10 a 30 s).
- **Olhinho:** agora é global (`toggleHideValues`/`setMasked`). Com valores ocultos, os valores em R$ nos textos da IA aparecem como bolinhas, igual ao resto do app.
- **Configurações › IA local:** máquina detectada, modelo em uso, tamanho no disco, velocidade medida, trocar, remover, desligar o Assistente.

## 6. Instruções do modelo

O prompt de sistema (pt-BR) e os exemplos de resposta ficam versionados em `src/ai/prompts/`. Regras: responder em português, curto, usar só valores dos fatos e das ferramentas, dizer "não tenho esse dado" quando faltar, recomendações no nível de classe (§2), sem inventar datas nem nomes de contas.

## 7. Avaliação e o "treino"

Treinar o modelo de verdade quase não melhora nada aqui. A qualidade vem das instruções, dos exemplos e de testar. O Claude escreve:

- **Bateria de avaliação** (`ai-eval/`, script Node fora do app): de 3 a 4 perfis financeiros inventados (bancos de mentira, tickers AAAA3) e de 40 a 60 perguntas, cada uma com resposta esperada e os valores que precisam aparecer. Roda contra o `llama-server` local com cada candidato e mede: valores certos, nenhum valor inventado, português, uso certo das ferramentas e tempo de resposta.
- **Prompts e exemplos** ajustados até passar na bateria. O modelo de cada faixa da §4 é o que tiver a melhor nota.
- **Fase opcional (só se a bateria mostrar falha que prompt não resolve):** ajuste fino LoRA com MLX no Mac, usando conversas sintéticas escritas pelo Claude sobre os perfis inventados, exportado para GGUF e publicado como um modelo próprio no catálogo. Fica fora da v1.

## Decisões minhas (para o usuário conferir)

- llama.cpp empacotado em vez de pedir para instalar o Ollama: o app continua "baixou, usou".
- Chat com ferramentas em vez de "jogar um resumo grande no prompt": é o único jeito de "quanto gastei com mercado este ano" sair certo sem o modelo somar.
- Chat não é salvo; insights são salvos (para não esperar de novo toda vez).
- Uma tela "Assistente" nova em vez de espalhar cards nos Resumos.
- Recomendações por classe, nunca por ticker, com rodapé de aviso.
- Catálogo só com **Qwen3** (licença Apache 2.0, download sem login no Hugging Face). Gemma sai: os repositórios oficiais exigem login para aceitar a licença, e isso quebra o "sem conta".
- A bateria roda no Mac do autor. Os modelos do Windows saem da mesma nota, e a calibração da §4 (abaixo de ~8 tokens/s, desce uma faixa) cobre as máquinas lentas. Sem bateria no CI na v1.
- O Assistente vem **visível por padrão** para quem atualizar, mas nada é baixado nem iniciado até a pessoa clicar em "Baixar e ativar". O instalador cresce só com o `llama-server`. "Desligar o Assistente" em Configurações esconde o item da sidebar e impede o servidor de subir; o modelo baixado fica até a pessoa removê-lo.

## Deixado para o builder

- Como empacotar o `llama-server` por plataforma (binário estático compilado no CI ou release oficial fixada) e o ajuste no `release.yml`.
- Download (Rust com eventos de progresso, sugestão: reqwest já vem com o tauri-plugin-http).
- Divisão de arquivos (sugestão: `src/ai/` para cliente, catálogo e conferência; `src/pages/assistente/` para a tela).
- Formato exato dos fatos e das ferramentas, desde que cada um tenha teste com dados inventados.
- Ordem de entrega sugerida: motor + hardware + download → insights → chat → bateria de avaliação e escolha dos modelos → Configurações.
