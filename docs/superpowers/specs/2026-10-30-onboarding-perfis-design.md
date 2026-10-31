# Perfis com PIN, setup inicial e novas Configurações

Mockups clicáveis: [`2026-10-30-onboarding-perfis-mockups.html`](2026-10-30-onboarding-perfis-mockups.html) (abrir no navegador; abas 1, 2, 2b e 3A valem; 3B foi descartada).

## Por quê

O app ganhou muitas features (gastos, orçamento, investimentos, Open Finance, Binance, IA local) e quem chega agora cai num app cheio, com uma pergunta de IA solta por cima e uma tela de Configurações que é um scroll de 13 cards sem ordem. Três pedidos do autor, nesta ordem de dependência:

1. **Vários usuários no mesmo app**, cada um com os seus dados, trocando pela sidebar, com PIN opcional de 4 dígitos.
2. **Setup inicial**: na primeira abertura a pessoa escolhe como quer usar o app (quais abas, quais contas conectar, se quer IA).
3. **Refazer Configurações**: hoje "está tudo jogado e bagunçado".

## Objetivo

- Perfis independentes no mesmo computador, cada um com nome, cor, avatar (foto opcional) e PIN opcional.
- O PIN **libera o acesso aos dados** do perfil: sem ele os dados não abrem, nem lendo o arquivo por fora do app.
- Um wizard de 5 passos na primeira abertura e ao criar perfil, mais um tour curto de balões dentro do app.
- Configurações em seções com menu lateral e busca (mockup 3A).

**Fora de escopo (v1):** bloqueio automático por inatividade; dados compartilhados entre perfis (ex.: uma conta de banco vista por dois perfis); sincronização em segundo plano de perfis que não estão abertos; recuperação de PIN esquecido; perfis com permissões diferentes (admin/convidado).

**Seria um fracasso se:**
- um perfil enxergar qualquer dado, credencial ou preferência de outro;
- os dados de um perfil com PIN ficarem legíveis no disco quando o app está fechado ou o perfil bloqueado;
- quem já usa o app perder dados, ser obrigado a passar pelo wizard ou a criar PIN ao atualizar;
- errar o PIN muitas vezes apagar dados;
- a criptografia deixar o app perceptivelmente mais lento no uso normal.

## Restrições

- Mesmas do projeto: repositório público (testes só com dados inventados), visual com `card`, `toggle-row`, `switch`, `Select`, lucide-react (**nunca emoji como ícone**), sem `window.confirm`, migrações só novas.
- Hoje: um banco só (`sqlite:yield.db`, `src/db/client.ts`), credenciais da Pluggy/Binance num item só do cofre do sistema (`src-tauri/src/lib.rs`, `vault_*`), preferências no `localStorage` (`src/ui/prefs.ts`, `src/ui/theme.tsx`, `src/ai/settings.ts`, `yield.route`). Tudo isso é global e passa a ser por perfil.
- Já existe Argon2 + AES-256-GCM no Rust para o backup com senha (`backup_key`, `encrypt_backup`): reaproveitar para derivar a chave do PIN.

## 1. Perfis

### O que é um perfil
- Um perfil = um banco SQLite próprio + um item próprio no cofre do sistema + preferências próprias (módulos ligados, tema, olhinho, menu recolhido, última tela, escolha de IA, tour visto).
- Fica **fora** do banco (para a tela de escolha funcionar antes do PIN): lista de perfis com id, nome, cor e avatar (`perfis.json`, avatar como imagem embutida). "Tem PIN" vem do cabeçalho do arquivo do banco (cifrado não começa com `SQLite format 3`); o sal do PIN e o estado do limite de tentativas ficam no `pins.json`, que só o Rust grava, com uma cópia do sal em `<banco>.salt`. Nome, cor e foto ficam visíveis sem PIN, como na tela de bloqueio de um celular.
- Os modelos de IA baixados são da máquina, compartilhados (5 GB não se baixa duas vezes); ligar ou não o Assistente é por perfil.
- Backup exporta e restaura **o perfil aberto**. Continua como hoje: o `.yield` é sempre criptografado com uma senha escolhida na hora (não é o PIN) e não leva as credenciais da Pluggy/Binance. Restaurar troca os dados e mantém o PIN que o perfil já tem.
- O tema das telas antes de abrir um perfil (escolha, PIN, espera, wizard de instalação nova) é o do último perfil aberto, guardado no `profiles.json` junto com a lista (tema não é dado sensível); sem nenhum perfil, escuro.

### Migração de quem já usa
- Na primeira abertura da versão nova, o `yield.db` atual vira o primeiro perfil, **sem PIN**, com as preferências do `localStorage` atual e o item atual do cofre. Nome do perfil: o nome cadastrado em Open Finance (`ownerNames`) se houver, senão "Meu perfil". Não mostra wizard.
- Nada é apagado na migração; se ela falhar no meio, o app continua abrindo o `yield.db` como hoje.

### Avatar
- Opcional. Sem foto, o avatar é a inicial do nome sobre a cor escolhida (6 cores da paleta).
- "Escolher foto…" abre o seletor de imagem (png/jpg/heic se o sistema suportar), recorta quadrado no centro e reduz para 256 px antes de salvar. Dá para trocar e remover em Configurações › Perfil.

### Telas
- **Quem está usando?** (mockup 1, primeira tela): aparece ao abrir o app **só se houver 2+ perfis**. Avatares grandes, cadeado em quem tem PIN, "Novo perfil". Com 1 perfil sem PIN o app abre direto, como hoje; com 1 perfil com PIN abre direto no teclado do PIN.
- **Teclado do PIN** (mockup 1, segunda tela): 4 bolinhas, teclado numérico clicável e digitação pelo teclado físico, "Voltar" para a escolha de perfil.
- **Troca pela sidebar** (mockup 1, terceira tela): o perfil aberto fica no topo da sidebar, abaixo do logo. Clique abre a lista com os perfis, "Novo perfil" e "Bloquear agora" (volta para a escolha). No menu recolhido vira só o avatar. No celular (menu aberto) aparece igual.
- Trocar de perfil fecha o banco atual, para a sincronização e o servidor de IA desse perfil, e abre o outro.

### PIN
- Opcional por perfil; ligar, trocar e tirar em Configurações › Perfil e PIN. Trocar ou tirar pede o PIN atual.
- O PIN **criptografa os dados do perfil**: o banco e o item do cofre. Sem o PIN não há como ler. **Esqueceu = perdeu**: a única saída é restaurar um backup. Ao criar o PIN, o app diz isso com todas as letras e oferece fazer um backup na hora.
- **Limite de tentativas:** 5 erros → espera de 1 min; cada nova rodada de 5 erros aumenta para 5 min, 15 min e 1 h (fica em 1 h). A contagem é gravada fora do banco e sobrevive a fechar o app. Durante a espera o teclado fica desligado e mostra a contagem regressiva (mockup 1, quarta tela). **Nunca apaga dados.**
- Limite honesto (registrar na tela de criar PIN, em uma frase): 4 dígitos protegem de quem usa este computador, não de quem copia o arquivo e testa as 10 mil combinações por fora.
- **PIN esquecido:** o teclado do PIN tem o link "Esqueci o PIN", que explica que os dados não têm como voltar e oferece **apagar este perfil** sem pedir o PIN. A confirmação é um diálogo do app (modal com o fundo `--overlay`, não `window.confirm`) que mostra nome e avatar do perfil, diz que tudo dele é apagado sem volta e exige digitar o nome do perfil para liberar o botão vermelho "Apagar perfil". Apagar remove o banco, o item do cofre, o avatar e as preferências; não expõe nada. Para recuperar a partir de um backup: "Novo perfil" → "Restaurar de um backup" cria um perfil novo com os dados do `.yield`.
- Ao criar um PIN para um perfil que já tem dados, os dados existentes são criptografados; ao tirar o PIN, voltam a ficar em claro. As duas operações não podem perder dados se o app fechar no meio.

## 2. Setup inicial (wizard)

Mockup 2. Tela cheia, passos à esquerda, todos puláveis exceto o primeiro (nome). Aparece na primeira abertura de uma instalação nova e ao criar um perfil. **Substitui** a `AiPergunta` que hoje aparece por cima do app.

1. **Seu perfil:** nome, cor, foto opcional, interruptor "Proteger com PIN" (abre o teclado para definir e confirmar).
2. **Como você quer usar:** três cartões multisseleção (Meus gastos, Orçamento, Investimentos), cada um listando as abas que liga; ao lado, uma prévia do menu como vai ficar. Pelo menos um marcado. Grava nos módulos (`useModules`).
3. **Conectar contas:** a lista depende do passo 2 — Open Finance (Pluggy, com o guia que já existe em `PluggyGuia`) para qualquer escolha; Binance e arquivos da B3 se Investimentos; CSV de orçamento se Orçamento. Cada item abre o fluxo que já existe hoje em Configurações.
4. **Assistente com IA:** "Sim" ou "Agora não", com o tamanho do download e se o computador roda bem (mesma lógica de `IaLocal`). "Sim" começa o download em segundo plano.
5. **Pronto:** resumo do que foi escolhido, interruptor "Mostrar um tour rápido" (ligado por padrão) e "Abrir o yield".

Voltar não perde o que foi preenchido. Fechar o app no meio do wizard: na próxima abertura o wizard volta no passo onde parou.

## 3. Tour dentro do app

Mockup 2b. Se ligado no fim do wizard: 3 a 5 balões, escurecendo o resto da tela e destacando a área, com "Pular tour", "Voltar" e "Próximo". Só aponta para o que existe no menu daquele perfil. Sugestão de paradas: as abas escolhidas, o perfil no topo da sidebar, o status de sincronização, o olhinho de ocultar valores, Configurações. Visto uma vez por perfil; dá para rever em Configurações › Perfil.

## 4. Configurações

Mockup 3A. A tela vira duas colunas: menu de seções com busca no topo + conteúdo da seção. A busca filtra o menu por nome da seção e por palavras dos ajustes dentro dela.

| Grupo | Seção | Vem de (hoje) |
|---|---|---|
| Você | Perfil e PIN | novo: nome, cor, avatar, PIN, "Refazer setup inicial", "Rever tour", apagar perfil (confirmação na tela, pede PIN se tiver) |
| | Aparência | `Aparencia` |
| | Abas do menu | `Modulos` |
| Dados | Contas conectadas | `OpenFinance` + `Contas` + transferências + `Binance` — lista por instituição com status (ok / erro / reconectar), credenciais da Pluggy num link secundário |
| | Importar arquivos | card "Importar da B3" (`useB3Import`) + `ImportarOrcamento` |
| | Renda e orçamento | `FontesRenda` |
| | Proventos | `Proventos` |
| Recursos | Assistente (IA) | `IaLocal` |
| | Cotações | card "Cotações" |
| App | Backup | card "Backup" (agora do perfil aberto) |
| | Atualizações | `AtualizacaoCard` |
| | Privacidade | o texto "Tudo fica neste computador…" com a lista de serviços |

- Os links "Abrir Configurações" das outras telas passam a abrir **direto na seção certa** (ex.: Orçamento → Importar arquivos; o aviso de nome e empresa → Contas conectadas; telas vazias de gastos → Contas conectadas).
- O menu mostra um selo quando há algo pedindo atenção (ex.: banco com erro em Contas conectadas, Assistente desligado).
- Lembra a última seção aberta (por perfil).
- No celular: o menu de seções vira uma lista; tocar abre a seção com "← Configurações".

## Decidido na conversa

- Cada perfil tem os próprios dados; o PIN libera o acesso completo a eles. Esqueceu o PIN, perdeu. Limite de tentativas sim, apagar dados não.
- Avatar com foto opcional.
- Perfil com PIN esquecido pode ser apagado sem o PIN, com diálogo de confirmação.
- Wizard + tour de balões (os dois). Configurações no formato A (menu de seções).
- Ícones Lucide, nunca emoji.

## Chamadas minhas (o autor pode reverter)

- Quem já usa não vê o wizard ao atualizar; vira o primeiro perfil sem PIN.
- Tempos da espera do PIN (5 erros; 1 min → 5 → 15 → 1 h).
- Nome, cor e avatar visíveis sem PIN.
- Modelos de IA compartilhados entre perfis; backup é por perfil.
- A tela de escolha só aparece com 2+ perfis.
- O diálogo de apagar perfil exige digitar o nome do perfil; restaurar backup pode criar um perfil novo ("Novo perfil" → "Restaurar de um backup").
- Restaurar backup mantém o PIN atual do perfil; o tema antes de abrir perfil é o do último perfil aberto.

## Deixado para quem implementar

- **Como criptografar o banco do perfil.** Requisitos: nada legível no disco com o app fechado ou o perfil bloqueado; nenhum arquivo em claro sobrando depois de um crash; sem perda de dados se o app fechar no meio de criar/tirar o PIN; desempenho igual ao de hoje no uso. Opções a avaliar: SQLite com criptografia nativa (SQLCipher pelo `libsqlite3-sys` usado por baixo do `tauri-plugin-sql`, com `PRAGMA key` em toda conexão do pool) ou outro caminho que atenda os requisitos. Abrir o arquivo inteiro descriptografado em disco enquanto o app roda **não** atende (crash deixa os dados em claro).
- Formato do `profiles.json`, nomes dos arquivos por perfil, nome do item do cofre por perfil.
- Como namespacear as preferências do `localStorage` por perfil.
- Como o `DataProvider` e a sincronização reiniciam ao trocar de perfil.
- Ordem das entregas. Sugestão: perfis sem PIN → PIN e criptografia → Configurações em seções → wizard e tour (o wizard usa as seções novas).
