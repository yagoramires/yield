# Bateria de avaliação da IA local

Perfis financeiros inventados (`perfis.ts`: Banco Laranja, AAAA3, FIIA11) e 40 perguntas (`perguntas.json`): 32 de chat e 8 de insights do mês. Cada pergunta traz os valores que precisam aparecer na resposta.

- `pnpm test` roda só a **autoconferência**: todo valor esperado precisa sair dos fatos ou das ferramentas do perfil. Assim a bateria não cobra um número que o app não tem.
- A **avaliação** fala com um `llama-server` de verdade e grava `resultados/<modelo>.md`. Ela mede, por pergunta: valores certos, valores não conferidos (que o app marca ou descarta), se usou a ferramenta certa, se respondeu em português e o tempo.

## Como rodar

```bash
pnpm llama   # compila o llama-server, se ainda não compilou
LLAMA_API_KEY=teste-local ./src-tauri/binaries/llama-server-aarch64-apple-darwin \
  -m <pasta>/Qwen3-8B-Q4_K_M.gguf --host 127.0.0.1 --port 18081 -c 8192 -np 1 --jinja --reasoning-budget 0 --no-webui
# em outro terminal
YIELD_EVAL_URL=http://127.0.0.1:18081 YIELD_EVAL_KEY=teste-local YIELD_EVAL_MODEL=qwen3-8b npx vitest run src/ai/eval/eval.test.ts
```

Os arquivos `.gguf` são os do `src/ai/catalog.json`, baixados do Hugging Face.

## Escolha dos modelos (30/10/2026, Apple M5 com 16 GB, llama.cpp b12017)

| faixa | modelo | valores certos | não conferidos no chat | ferramenta certa | português | tempo médio |
|---|---|---|---|---|---|---|
| média | **Qwen3 8B** Q4_K_M | 37/40 (93%) | 0 | 30/31 | 40/40 | 5,2 s |
| leve | **Qwen3 4B** Q4_K_M | 34/40 (85%) | 0 | 30/31 | 40/40 | 3,3 s |

Nos dois, 2 insights foram descartados pela conferência (citavam um valor que não está nos fatos) e não aparecem para a pessoa. O 4B ainda confunde o valor de uma classe com o patrimônio ("Quanto tenho em ações?"). Os dois às vezes dizem "dentro do orçamento" sem haver orçamento no mês: frase sem número, que a conferência não pega.

O que a bateria mudou no app: a busca de lançamentos também olha a categoria; categoria preenchida com "null" vale como sem filtro, e categoria que não existe vira erro com a lista das que existem; período vazio avisa onde há dado; chamada de ferramenta escrita como texto também roda; a rentabilidade já vem com a comparação com o CDI; os fatos não comparam com um mês anterior vazio.
