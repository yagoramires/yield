"""Gera docs/security-audit/relatorio-auditoria-seguranca.pdf.

Regerar (venv isolado, nada global):
    uv venv --python 3.12 docs/security-audit/.venv
    uv pip install --python docs/security-audit/.venv/bin/python reportlab matplotlib pymupdf
    docs/security-audit/.venv/bin/python docs/security-audit/gerar_relatorio.py
"""
from collections import Counter
from pathlib import Path
from xml.sax.saxutils import escape

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (CondPageBreak, Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer,
                                Table, TableStyle)

HERE = Path(__file__).parent
OUT = HERE / "relatorio-auditoria-seguranca.pdf"
CHARTS = HERE / "_charts"
PROJETO = "Yield"
DATA = "30/10/2026"
COMMIT = "7bb9c48 (main)"
TITULO = f"Relatório de Auditoria de Segurança — {PROJETO}"

SEV = {  # ordem, cor, rótulo
    "critica": (0, "#B91C1C", "Crítica"),
    "alta": (1, "#EA580C", "Alta"),
    "media": (2, "#D97706", "Média"),
    "baixa": (3, "#2563EB", "Baixa"),
    "info": (4, "#6B7280", "Informativa"),
}
FORTE = "#059669"
INK = "#111827"
MUTED = "#4B5563"
LINE = "#E5E7EB"

CATS = {
    1: "Banco sem tranca",
    2: "Permissão no navegador",
    3: "IDOR",
    4: "Chaves expostas",
    5: "Inputs sem tratamento (XSS)",
}

# ---------------------------------------------------------------- dados da auditoria

METODO = [
    (1, "Banco sem tranca",
     "App desktop de usuário único: não há tenant, login nem RLS. O isolamento equivalente é (a) as capabilities do Tauri, "
     "que dizem o que o webview pode chamar, e (b) a proteção do arquivo SQLite e das cópias no disco."),
    (2, "Permissão definida no navegador",
     "Não existem papéis (isAdmin, canEdit). Os \"Módulos\" de Configurações só escondem itens do menu e não são controle de acesso. "
     "O equivalente é o core Rust confiar no que o webview pede: segredos devolvidos ao JS e comandos privilegiados sem checagem."),
    (3, "IDOR",
     "Não há objetos de outros usuários. O equivalente são os comandos IPC (#[tauri::command]) que recebem um caminho de arquivo "
     "e agem sobre ele sem conferir se está no escopo do app. Os 8 comandos registrados foram lidos um a um."),
    (4, "Chaves expostas",
     "Busca por padrões de segredo no código, configs, workflows de CI, docs, histórico git completo (224 commits, todas as "
     "branches) e no bundle dist/. Não há docker-compose, Helm nem Terraform."),
    (5, "Inputs sem tratamento (XSS)",
     "Frontend React 19: busca por dangerouslySetInnerHTML, innerHTML, eval, new Function, href/src dinâmicos e window.open; "
     "revisão da CSP do Tauri e das libs que parseiam arquivos do usuário (pdf.js, SheetJS). Não há backend HTTP nem e-mails."),
]

STACK = [
    ("Linguagens", "TypeScript (frontend), Rust 2024 (core)"),
    ("Framework", "Tauri 2 (app desktop macOS/Windows) + React 19 + Vite 8"),
    ("Banco", "SQLite local via tauri-plugin-sql, SQL escrito à mão com placeholders ?"),
    ("Auth / segredos", "Sem login. Credenciais Pluggy e Binance no cofre do SO (keyring), backup com AES-256-GCM + Argon2id"),
    ("Rede", "tauri-plugin-http com allowlist de 5 hosts (Yahoo, Pluggy, BCB, Binance)"),
    ("Deploy", "GitHub Actions (build.yml, release.yml) + updater do Tauri assinado (minisign)"),
]

# id, categoria, severidade, arquivo, linhas, título, trecho, por que, condição
FINDINGS = [
    dict(id="F1", cat=3, sev="media", file="src-tauri/src/lib.rs", lines="84-91 (registro na 303)",
         title="encrypt_backup lê, criptografa e APAGA qualquer arquivo indicado pelo webview",
         code='#[tauri::command]\nfn encrypt_backup(from: String, to: String, password: String) -> Result<(), String> {\n'
              '    let plain = std::fs::read(&from).map_err(|e| e.to_string())?;\n'
              '    let sealed = seal(&plain, &password);\n'
              '    std::fs::remove_file(&from).map_err(|e| e.to_string())?;\n'
              '    std::fs::write(&to, sealed?).map_err(|e| e.to_string())\n}',
         why="from e to vêm do JS sem nenhuma checagem de pasta ou extensão. Um script no webview pode chamar "
             "invoke('encrypt_backup', {from: '~/Documents/x.pdf', to: '/tmp/y', password: 'p'}): o arquivo original é apagado e "
             "fica só uma cópia cifrada com a senha do atacante (primitiva de ransomware/destruição de qualquer arquivo que o usuário pode escrever).",
         cond="Precisa de JavaScript arbitrário rodando no webview (XSS ou dependência npm comprometida). Nenhum sink de XSS foi "
              "encontrado hoje, mas a CSP está desligada (F4)."),
    dict(id="F2", cat=3, sev="media", file="src-tauri/src/lib.rs", lines="44-52 (registro na 303)",
         title="move_file move/sobrescreve qualquer arquivo e não é usado pelo app",
         code='#[tauri::command]\nfn move_file(from: String, to: String) -> Result<(), String> {\n'
              '    if std::fs::rename(&from, &to).is_ok() {\n        return Ok(());\n    }\n'
              '    std::fs::copy(&from, &to).map_err(|e| e.to_string())?;\n'
              '    std::fs::remove_file(&from).map_err(|e| e.to_string())\n}',
         why="Nenhum invoke('move_file') existe em src/ (grep), mas o comando continua registrado no invoke_handler e aceita "
             "quaisquer caminhos. Permite mover, sobrescrever ou sumir com arquivos do usuário. É superfície de ataque sem uso.",
         cond="Mesma de F1: JS arbitrário no webview."),
    dict(id="F3", cat=3, sev="baixa", file="src-tauri/src/lib.rs", lines="33-42, 93-99, 102-109",
         title="swap_database, is_encrypted_backup e decrypt_backup aceitam qualquer caminho",
         code='fn swap_database(app: tauri::AppHandle, source: String) -> Result<String, String> {\n'
              '    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;\n'
              '    let source = Path::new(&source);\n'
              '    let backup = swap_in_dir(&dir, source)?;',
         why="swap_database copia qualquer arquivo por cima do yield.db (o banco anterior vira seguranca-<ts>.db, então dá para "
             "desfazer). decrypt_backup e is_encrypted_backup leem qualquer caminho, mas só revelam se o arquivo começa com "
             "YIELDBK1; unseal() recusa o resto. Impacto limitado a negação de serviço do app.",
         cond="JS arbitrário no webview."),
    dict(id="F4", cat=5, sev="media", file="src-tauri/tauri.conf.json", lines="21-24",
         title="CSP desligada na janela do app",
         code='"security": {\n  "csp": null\n}',
         why="Sem CSP não há segunda barreira: se algum dado importado (extrato OFX/CSV, planilha B3, PDF de nota, resposta da "
             "Pluggy/Binance) virar HTML executável no futuro, o script ganha acesso a todos os comandos IPC: lê as credenciais "
             "(F5), apaga arquivos (F1/F2) e roda SQL no banco (F8). Hoje o React escapa tudo e não há sink perigoso.",
         cond="Agravante: vira explorável junto com um XSS ou dependência comprometida. Desde o commit efa2177 (26/10/2026)."),
    dict(id="F5", cat=2, sev="baixa", file="src-tauri/src/lib.rs", lines="164-167; src/secrets/vault.ts:12,18-19; src/cripto/binance.ts:34-35",
         title="Segredos da Pluggy e da Binance são devolvidos em texto puro ao JavaScript",
         code='#[tauri::command]\nfn secret_get(key: String) -> Result<Option<String>, String> {\n'
              '    get_with(&entry_for(&key)?)\n}\n'
              '// binance.ts:34\nconst u = binanceRequest(\'GET\', `${path}?${query}&signature=${await sign(creds.secret, query)}`)',
         why="O cofre do SO protege o segredo em repouso, mas o core entrega o JSON com clientSecret da Pluggy e a secret key da "
             "Binance ao webview, que assina o HMAC em JS. Qualquer código que rode no webview lê os dois e acessa todos os dados "
             "bancários do usuário via Pluggy.",
         cond="JS arbitrário no webview. Por design hoje; o risco cresce com F4."),
    dict(id="F6", cat=1, sev="baixa", file="src-tauri/src/lib.rs", lines="102-109, 38-40; src/pages/Configuracoes.tsx:156",
         title="Backup com senha fica descriptografado no disco (restore.db) ao cancelar a importação",
         code='let out = dir.join(RESTORE_FILE);\nstd::fs::write(&out, plain).map_err(|e| e.to_string())?;\n'
              '// Configuracoes.tsx:156\n<button ... onClick={() => setRestore(null)}>Cancelar</button>',
         why="decrypt_backup grava o banco inteiro em texto puro em <app_config_dir>/restore.db. Só swap_database apaga esse "
             "arquivo. Se o usuário cancela (ou a validação falha), a cópia sem senha fica lá para sempre, anulando a proteção do "
             "backup .yield.",
         cond="Acesso de leitura à pasta do app (outro usuário/malware local, backup do Time Machine, sincronização de nuvem)."),
    dict(id="F7", cat=4, sev="baixa", file=".github/workflows/release.yml", lines="25-39, 56-60",
         title="Chave de assinatura do updater exposta a actions de terceiros referenciadas por tag mutável",
         code='- uses: tauri-apps/tauri-action@v0\n  env:\n    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}\n'
              '    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}',
         why="Os segredos não estão no código (correto), mas tauri-action@v0, swatinem/rust-cache@v2, pnpm/action-setup@v4 e "
             "dtolnay/rust-toolchain@stable são tags que o dono da action pode mover. Uma tag sequestrada roda no job que tem a "
             "chave privada do updater: o atacante assina uma atualização maliciosa que todos os apps instalados aceitam.",
         cond="Comprometimento de uma action de terceiros (supply chain). Probabilidade baixa, impacto alto."),
    dict(id="F8", cat=1, sev="info", file="src-tauri/capabilities/default.json", lines="9-12; src/pages/Configuracoes.tsx:59",
         title="Webview tem SQL irrestrito e pode abrir qualquer arquivo SQLite",
         code='"sql:default",\n"sql:allow-execute",\n"sql:allow-close",\n'
              '// Configuracoes.tsx:59\nsource = await openDb(`sqlite:${path}`)',
         why="É o modelo do app (todo o domínio roda em TS), não um furo isolado: o webview lê e escreve o banco inteiro e o "
             "load do plugin aceita qualquer caminho. Com ATTACH/VACUUM INTO o SQL também cria arquivos SQLite em qualquer pasta. "
             "Fica registrado porque define o tamanho do estrago de um XSS.",
         cond="JS arbitrário no webview."),
    dict(id="F9", cat=1, sev="info", file="src-tauri/src/lib.rs", lines="13-14",
         title="Banco e cópias de segurança ficam em texto puro e se acumulam",
         code='let backup = dir.join(format!("seguranca-{secs}.db"));\nstd::fs::copy(&db, &backup).map_err(err)?;',
         why="yield.db não é cifrado em repouso (decisão de projeto) e cada importação de backup deixa mais uma cópia "
             "seguranca-<ts>.db completa, sem rotação.",
         cond="Acesso de leitura à pasta do app."),
]

STRENGTHS = [
    ("SQL parametrizado em todo o código",
     "Todas as consultas de src/db, src/domain, src/import e src/openfinance usam placeholders ?. O único identificador "
     "interpolado vem de lista fixa: src/db/gastosRepo.ts:130 (['category_overrides', 'category_rules', 'budget_lines'])."),
    ("Nenhum sink de XSS no frontend",
     "Zero ocorrências de dangerouslySetInnerHTML, innerHTML, outerHTML, insertAdjacentHTML, document.write, eval, new Function, "
     "window.open, <a href>/<img src> dinâmicos em src/. Todo texto passa pelo escape do JSX."),
    ("Libs de parsing atualizadas",
     "pdfjs-dist 6.4.299 (fora da CVE-2024-4367, corrigida na 4.2.67) e SheetJS 0.20.3 (corrige CVE-2023-30533 e CVE-2024-22363)."),
    ("Rede com allowlist em duas camadas",
     "capabilities/default.json:13-32 libera só 5 hosts; src/openfinance/pluggy.ts:30-32 e src/cripto/binance.ts:18-19 "
     "recusam qualquer método/caminho fora da lista (só leitura)."),
    ("Erros de API não vazam segredo",
     "Mensagens de erro da Pluggy/Binance não incluem corpo nem chave; coberto por src/openfinance/pluggy.test.ts:158-162."),
    ("Cofre do SO com allowlist de chaves",
     "Credenciais só no keyring (src-tauri/src/lib.rs:134-177); entry_for() recusa chave fora de SECRET_KEYS, com teste em lib.rs:347."),
    ("Backup bem criptografado",
     "AES-256-GCM com chave Argon2id, sal de 16 bytes e nonce novos a cada backup (lib.rs:54-82); senha mínima de 8 caracteres "
     "(src/pages/configuracoes/build.ts:174); teste de senha errada e adulteração em lib.rs:313."),
    ("Nenhum segredo no repositório",
     "Código, configs, docs, histórico git (224 commits, todas as branches) e bundle dist/ limpos. Credenciais dos testes são "
     "falsas ('cid', 'segredo-xyz'). Chave pública do updater e fingerprint do certificado (release.yml:20) são públicos por natureza."),
    ("Segredos de CI via secrets.*",
     "release.yml:43-44 e 58-60 leem tudo de secrets; o .p12 é apagado após importar (release.yml:52) num keychain temporário."),
    ("Atualizações assinadas",
     "Updater só aceita pacotes assinados com a chave minisign (tauri.conf.json:42) e baixa de HTTPS no GitHub."),
    ("Superfície de plugins enxuta",
     "Sem plugin de fs nem shell; capability só para a janela main. Dados pessoais (planilhas/, notas/, extratos/) estão no "
     ".gitignore e as fixtures de teste são sintéticas."),
]

RECS = [
    ("P1", "media", "Escopar os comandos IPC de arquivo (F1, F2, F3)",
     "Apagar move_file. Em encrypt_backup aceitar só from dentro do app_data_dir com prefixo export-. Abrir os diálogos de "
     "salvar/abrir no Rust (plugin dialog) para que o caminho de destino e o de origem nunca venham do JS."),
    ("P2", "media", "Ligar a CSP (F4)",
     "Definir app.security.csp com default-src 'self', script-src 'self', connect-src ipc: http://ipc.localhost, "
     "worker-src 'self' blob: e img-src 'self' data:. Testar import de PDF e gráficos depois."),
    ("P3", "baixa", "Tirar os segredos do JavaScript (F5)",
     "Mover POST /auth da Pluggy e a assinatura HMAC da Binance para comandos Rust; o JS recebe só o token de 2h ou a resposta."),
    ("P4", "baixa", "Limpar restore.db (F6)",
     "Apagar restore.db ao cancelar, quando a validação falha e no startup do app."),
    ("P5", "baixa", "Fixar as actions por SHA (F7)",
     "Trocar @v0/@v2/@v4/@stable pelo SHA do commit e proteger o job de release com um environment com aprovação."),
    ("P6", "info", "Dados em repouso (F8, F9)",
     "Rotacionar as cópias seguranca-*.db (manter as N últimas) e avaliar SQLCipher se o app passar a guardar mais dados sensíveis."),
]

ISSUES = [
    dict(title="[Segurança] Comandos IPC de arquivo aceitam qualquer caminho (encrypt_backup, move_file, swap_database)",
         labels="security, severity:media",
         body="""## Descrição
Os comandos Rust que mexem em arquivos recebem caminhos vindos do webview e não conferem se estão dentro da pasta do app. Qualquer JavaScript que rode no webview (XSS ou dependência npm comprometida) pode apagar, mover ou sobrescrever arquivos do usuário. `encrypt_backup` ainda apaga o original depois de cifrá-lo com uma senha escolhida pelo chamador.

## Evidência
`src-tauri/src/lib.rs:84-91`
```rust
fn encrypt_backup(from: String, to: String, password: String) -> Result<(), String> {
    let plain = std::fs::read(&from).map_err(|e| e.to_string())?;
    let sealed = seal(&plain, &password);
    std::fs::remove_file(&from).map_err(|e| e.to_string())?;
    std::fs::write(&to, sealed?).map_err(|e| e.to_string())
}
```
`src-tauri/src/lib.rs:44-52` - `move_file(from, to)` faz rename/copy+remove de qualquer caminho e não tem nenhum `invoke('move_file')` em `src/`.
`src-tauri/src/lib.rs:33-42` - `swap_database(source)` copia qualquer arquivo por cima do `yield.db`.
`src-tauri/src/lib.rs:303` - os três estão no `invoke_handler`.

## Impacto
Com JS no webview: destruição ou "sequestro" de qualquer arquivo que o usuário pode escrever, e corrupção do banco do app.

## Sugestão de correção
- Remover `move_file` do código e do `generate_handler!`.
- `encrypt_backup`: aceitar só `from` dentro de `app_data_dir` com nome `export-*.db`.
- Fazer os diálogos de salvar/abrir no Rust e não receber `to`/`source` do JS.
- `swap_database`: aceitar só `restore.db` ou um caminho devolvido pelo diálogo nativo.

## Critérios de aceite
- [ ] `move_file` não existe mais no `lib.rs`.
- [ ] `invoke('encrypt_backup', { from: '<arquivo fora do app>' , ... })` devolve erro e não apaga nada.
- [ ] `swap_database` com caminho arbitrário devolve erro.
- [ ] Teste Rust cobrindo a recusa de caminhos fora do escopo.
- [ ] Exportar e importar backup continuam funcionando.""",
         sev="media"),
    dict(title="[Segurança] CSP desligada na janela do Tauri",
         labels="security, severity:media",
         body="""## Descrição
A janela do app roda sem Content Security Policy. Hoje não há sink de XSS (o React escapa tudo), mas o app processa muitos dados de fora (OFX/CSV, planilhas da B3, PDFs de notas, respostas da Pluggy e da Binance). Sem CSP, um único XSS no futuro tem acesso total aos comandos IPC: credenciais, arquivos e banco.

## Evidência
`src-tauri/tauri.conf.json:21-24`
```json
"security": {
  "csp": null
}
```

## Impacto
Transforma qualquer XSS futuro em leitura das credenciais da Pluggy/Binance, destruição de arquivos (ver issue dos comandos IPC) e SQL arbitrário no banco.

## Sugestão de correção
```json
"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src ipc: http://ipc.localhost"
```
Ajustar após testar import de PDF (worker do pdf.js) e as telas com gráficos.

## Critérios de aceite
- [ ] `app.security.csp` definido no `tauri.conf.json` sem `'unsafe-eval'`.
- [ ] Build de release abre todas as telas sem erro de CSP no console.
- [ ] Importação de PDF, B3, OFX/CSV, sync da Pluggy e da Binance funcionam.""",
         sev="media"),
    dict(title="[Segurança] Segredos da Pluggy e da Binance chegam em texto puro ao JavaScript",
         labels="security, severity:baixa",
         body="""## Descrição
O cofre do SO protege as credenciais em repouso, mas `secret_get` devolve o JSON completo ao webview, que usa o `clientSecret` da Pluggy para o `POST /auth` e a secret da Binance para assinar o HMAC em JS. Qualquer script no webview lê as duas.

## Evidência
`src-tauri/src/lib.rs:164-167`
```rust
fn secret_get(key: String) -> Result<Option<String>, String> {
    get_with(&entry_for(&key)?)
}
```
`src/secrets/vault.ts:12,18-19` lê e faz `JSON.parse` do item. `src/cripto/binance.ts:34` assina com `creds.secret`.

## Impacto
Com JS no webview: acesso de leitura a todas as contas e investimentos ligados na Pluggy e aos saldos/histórico da Binance.

## Sugestão de correção
- Criar comandos Rust `pluggy_auth` (devolve só a apiKey de 2h) e `binance_signed_get(path, query)`.
- `secret_get` passa a devolver só se a credencial existe (bool).

## Critérios de aceite
- [ ] Nenhum `clientSecret` nem secret da Binance trafega do Rust para o JS.
- [ ] `secret_get` não devolve o valor do segredo.
- [ ] Sync da Pluggy e da Binance continuam funcionando, com teste.""",
         sev="baixa"),
    dict(title="[Segurança] Backup com senha fica descriptografado no disco (restore.db) ao cancelar",
         labels="security, severity:baixa",
         body="""## Descrição
Ao abrir um backup `.yield`, `decrypt_backup` grava o banco inteiro em texto puro em `<app_config_dir>/restore.db`. Só `swap_database` apaga esse arquivo. Se o usuário clica em Cancelar ou a validação falha, a cópia sem senha fica no disco.

## Evidência
`src-tauri/src/lib.rs:106-107`
```rust
let out = dir.join(RESTORE_FILE);
std::fs::write(&out, plain).map_err(|e| e.to_string())?;
```
`src-tauri/src/lib.rs:38-40` - único ponto que remove o arquivo.
`src/pages/Configuracoes.tsx:156` - Cancelar só faz `setRestore(null)`.

## Impacto
Anula a criptografia do backup para quem lê a pasta do app (malware local, outro usuário, Time Machine, pasta sincronizada).

## Sugestão de correção
- Comando `discard_restore` chamado no Cancelar e quando `validar` falha.
- Apagar `restore.db` no startup do app.

## Critérios de aceite
- [ ] Depois de Cancelar, `restore.db` não existe.
- [ ] Depois de uma validação que falha, `restore.db` não existe.
- [ ] Ao abrir o app, um `restore.db` órfão é apagado.""",
         sev="baixa"),
    dict(title="[Segurança] Fixar por SHA as actions que recebem a chave de assinatura do updater",
         labels="security, severity:baixa",
         body="""## Descrição
O job de release passa `TAURI_SIGNING_PRIVATE_KEY` para `tauri-apps/tauri-action@v0` e roda no mesmo job `pnpm/action-setup@v4`, `swatinem/rust-cache@v2` e `dtolnay/rust-toolchain@stable`. Tags podem ser movidas pelo dono da action; uma tag sequestrada recebe a chave.

## Evidência
`.github/workflows/release.yml:56-60`
```yaml
- uses: tauri-apps/tauri-action@v0
  env:
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```
Linhas 25-39: demais actions por tag.

## Impacto
Com a chave do updater, um atacante publica uma atualização maliciosa aceita por todos os apps instalados.

## Sugestão de correção
- Trocar cada `@tag` pelo SHA completo do commit (com comentário da versão).
- Ativar Dependabot para `github-actions`.
- Colocar o job de release num `environment` com aprovação manual.

## Critérios de aceite
- [ ] Todas as `uses:` de `release.yml` e `build.yml` usam SHA de 40 caracteres.
- [ ] Dependabot configurado para GitHub Actions.
- [ ] Release só roda após aprovação no environment.""",
         sev="baixa"),
]

# ---------------------------------------------------------------- estilo

ss = getSampleStyleSheet()
BASE = "Helvetica"
st = {
    "h1": ParagraphStyle("h1", parent=ss["Heading1"], fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=INK, spaceAfter=10),
    "h2": ParagraphStyle("h2", parent=ss["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=INK, spaceBefore=10, spaceAfter=6),
    "h3": ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=INK, spaceBefore=6, spaceAfter=3),
    "p": ParagraphStyle("p", fontName=BASE, fontSize=9.5, leading=13.5, textColor=INK, spaceAfter=5),
    "muted": ParagraphStyle("muted", fontName=BASE, fontSize=8.5, leading=12, textColor=MUTED),
    "cell": ParagraphStyle("cell", fontName=BASE, fontSize=8.3, leading=11, textColor=INK),
    "cellb": ParagraphStyle("cellb", fontName="Helvetica-Bold", fontSize=8.3, leading=11, textColor=INK),
    "code": ParagraphStyle("code", fontName="Courier", fontSize=7.4, leading=9.6, textColor="#1F2937"),
    "chip": ParagraphStyle("chip", fontName="Helvetica-Bold", fontSize=7.5, leading=9, textColor=colors.white, alignment=TA_CENTER),
    "cover_t": ParagraphStyle("ct", fontName="Helvetica-Bold", fontSize=26, leading=32, textColor=INK, spaceAfter=8),
    "cover_s": ParagraphStyle("cs", fontName=BASE, fontSize=12, leading=17, textColor=MUTED),
    "kpi_n": ParagraphStyle("kn", fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=colors.white, alignment=TA_CENTER),
    "kpi_l": ParagraphStyle("kl", fontName=BASE, fontSize=8, leading=10, textColor=colors.white, alignment=TA_CENTER),
}


def P(text, style="p"):
    return Paragraph(text, st[style])


def code_block(text, width):
    lines = "<br/>".join(escape(l).replace("  ", "&nbsp;&nbsp;") for l in text.split("\n"))
    t = Table([[Paragraph(lines, st["code"])]], colWidths=[width])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F3F4F6")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#D1D5DB")),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def chip(sev):
    _, color, label = SEV[sev]
    t = Table([[Paragraph(label.upper(), st["chip"])]], colWidths=[2.0 * cm], rowHeights=[0.48 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(color)),
        ("ROUNDEDCORNERS", [4, 4, 4, 4]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2), ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    return t


def zebra(t, header=True):
    style = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor(LINE)),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(INK)), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white)]
    t.setStyle(TableStyle(style))
    return t


# ---------------------------------------------------------------- gráficos

def charts():
    CHARTS.mkdir(exist_ok=True)
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10})
    counts = Counter(f["sev"] for f in FINDINGS)
    order = [k for k in SEV if counts[k]]

    fig, ax = plt.subplots(figsize=(4.2, 4.2), dpi=200)
    ax.pie([counts[k] for k in order], colors=[SEV[k][1] for k in order], startangle=90, counterclock=False,
           wedgeprops=dict(width=0.38, edgecolor="white", linewidth=2.5),
           labels=[f"{SEV[k][2]}\n{counts[k]}" for k in order], labeldistance=1.16,
           textprops=dict(color=INK, fontsize=10.5, fontweight="bold", ha="center"))
    ax.text(0, 0.08, str(len(FINDINGS)), ha="center", va="center", fontsize=30, fontweight="bold", color=INK)
    ax.text(0, -0.22, "achados", ha="center", va="center", fontsize=11, color=MUTED)
    ax.set_aspect("equal")
    fig.savefig(CHARTS / "rosca.png", bbox_inches="tight", transparent=False, facecolor="white")
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(6.4, 3.4), dpi=200)
    cats = list(CATS)
    left = [0] * len(cats)
    for sev in SEV:
        vals = [sum(1 for f in FINDINGS if f["cat"] == c and f["sev"] == sev) for c in cats]
        if not any(vals):
            continue
        ax.barh(range(len(cats)), vals, left=left, color=SEV[sev][1], label=SEV[sev][2], height=0.58, edgecolor="white", linewidth=1.5)
        left = [l + v for l, v in zip(left, vals)]
    ax.set_yticks(range(len(cats)), [f"{c}. {CATS[c]}" for c in cats])
    ax.invert_yaxis()
    ax.set_xticks(range(0, max(left) + 2))
    ax.set_xlabel("achados", color=MUTED)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.spines["left"].set_color(LINE); ax.spines["bottom"].set_color(LINE)
    ax.tick_params(colors=INK)
    ax.grid(axis="x", color=LINE, linewidth=0.8); ax.set_axisbelow(True)
    for i, total in enumerate(left):
        ax.text(total + 0.08, i, str(total), va="center", fontsize=10, fontweight="bold", color=INK)
    ax.legend(loc="lower right", frameon=False, fontsize=9)
    fig.savefig(CHARTS / "barras.png", bbox_inches="tight", facecolor="white")
    plt.close(fig)


# ---------------------------------------------------------------- páginas

def on_page(canvas, doc):
    if doc.page == 1:
        canvas.saveState()
        canvas.setFillColor(colors.HexColor(INK))
        canvas.rect(0, A4[1] - 1.1 * cm, A4[0], 1.1 * cm, stroke=0, fill=1)
        canvas.setFillColor(colors.HexColor(FORTE))
        canvas.rect(0, A4[1] - 1.25 * cm, A4[0], 0.15 * cm, stroke=0, fill=1)
        canvas.restoreState()
        return
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor(MUTED))
    canvas.drawString(2 * cm, A4[1] - 1.3 * cm, TITULO)
    canvas.drawRightString(A4[0] - 2 * cm, A4[1] - 1.3 * cm, DATA)
    canvas.setStrokeColor(colors.HexColor(LINE))
    canvas.line(2 * cm, A4[1] - 1.45 * cm, A4[0] - 2 * cm, A4[1] - 1.45 * cm)
    canvas.line(2 * cm, 1.45 * cm, A4[0] - 2 * cm, 1.45 * cm)
    canvas.drawString(2 * cm, 1.05 * cm, f"{PROJETO} · commit {COMMIT} · confidencial")
    canvas.drawRightString(A4[0] - 2 * cm, 1.05 * cm, f"Página {doc.page}")
    canvas.restoreState()


def build():
    charts()
    W = A4[0] - 4 * cm
    doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm,
                            title=TITULO, author="Auditoria automatizada (Claude Code)", subject="Auditoria de segurança")
    s = []
    counts = Counter(f["sev"] for f in FINDINGS)

    # a) capa
    s += [Spacer(1, 2.2 * cm), P("RELATÓRIO DE SEGURANÇA", "muted"), Spacer(1, 4), P(TITULO, "cover_t"),
          P(f"Data: <b>{DATA}</b> &nbsp;·&nbsp; Base auditada: <b>{COMMIT}</b>", "cover_s"), Spacer(1, 0.8 * cm),
          P("Escopo auditado", "h2"),
          P("Repositório completo: <font name='Courier'>src/</font> (106 arquivos TS/TSX), <font name='Courier'>src-tauri/</font> "
            "(core Rust, 17 migrações, capabilities, tauri.conf.json), <font name='Courier'>.github/workflows/</font>, docs, "
            "histórico git (224 commits) e o bundle <font name='Courier'>dist/</font>. Cinco categorias: isolamento de dados, "
            "permissão decidida no cliente, IDOR, chaves expostas e XSS.")]
    stack = Table([[P(k, "cellb"), P(v, "cell")] for k, v in STACK], colWidths=[3.4 * cm, W - 3.4 * cm])
    s += [P("Stack detectada", "h2"), zebra(stack, header=False), PageBreak()]

    s += [P("Nota metodológica", "h1"),
          P("O Yield não tem servidor nem contas de usuário: é um app desktop em que o webview (React) conversa com o core "
            "(Rust) por IPC. A fronteira de confiança que importa é webview → core. Por isso cada categoria foi traduzida "
            "para o equivalente desta stack:")]
    met = Table([[P("<font color='white'><b>#</b></font>", "cell"), P("<font color='white'><b>Categoria</b></font>", "cell"), P("<font color='white'><b>Como foi mapeada nesta stack</b></font>", "cell")]] +
                [[P(str(n), "cellb"), P(c, "cellb"), P(d, "cell")] for n, c, d in METODO],
                colWidths=[0.8 * cm, 3.6 * cm, W - 4.4 * cm])
    zebra(met)
    met.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white)]))
    s += [met, Spacer(1, 8),
          P("Só entram achados verificados no código. Cada um traz arquivo e linha, trecho, por que é explorável e a condição "
            "de exploração. Escala: <b>crítica</b> (explorável direto, dano grave), <b>alta</b>, <b>média</b> (dano grave mas "
            "precisa de uma condição extra), <b>baixa</b> (impacto ou probabilidade pequenos) e <b>informativa</b> "
            "(decisão de projeto registrada para contexto).", "muted"),
          PageBreak()]

    # b) resumo executivo
    s += [P("Resumo executivo", "h1"),
          P("Nenhum achado crítico ou alto. O código básico está sólido: SQL parametrizado, nenhum sink de XSS, segredos fora do "
            "repositório e no cofre do SO, backup com criptografia correta. Os riscos que sobram se concentram na fronteira "
            "webview → core: comandos de arquivo sem escopo e CSP desligada. Isolados, exigem que algum JavaScript estranho rode "
            "no webview; juntos, um XSS futuro viraria apagar arquivos do usuário e ler suas credenciais bancárias.")]
    kpis = [(SEV[k][2], counts[k], SEV[k][1]) for k in SEV] + [("Pontos fortes", len(STRENGTHS), FORTE)]
    cells = [[Table([[P(str(n), "kpi_n")], [P(l, "kpi_l")]], colWidths=[W / 6 - 6], rowHeights=[0.9 * cm, 0.45 * cm],
                    style=[("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(c)), ("ROUNDEDCORNERS", [6, 6, 6, 6]),
                           ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 2),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]) for l, n, c in kpis]]
    s += [Spacer(1, 4), Table(cells, colWidths=[W / 6] * 6, style=[("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]),
          Spacer(1, 10)]
    s += [Table([[Image(str(CHARTS / "rosca.png"), width=6.2 * cm, height=6.2 * cm),
                  P("<b>Achados por severidade</b><br/><br/>" + "<br/>".join(
                      f"<font color='{SEV[k][1]}'>&#9632;</font> {SEV[k][2]}: <b>{counts[k]}</b>" for k in SEV) +
                    f"<br/><font color='{FORTE}'>&#9632;</font> Pontos fortes: <b>{len(STRENGTHS)}</b>", "p")]],
                colWidths=[7 * cm, W - 7 * cm], style=[("VALIGN", (0, 0), (-1, -1), "MIDDLE")]),
          P("<b>Achados por categoria</b>", "p"),
          Image(str(CHARTS / "barras.png"), width=W, height=W * 3.4 / 6.4 * 0.93), PageBreak()]

    # c) pontos fortes e fracos
    s += [P("Pontos fortes", "h1"), P("O que foi verificado e está correto, com a evidência.", "muted"), Spacer(1, 4)]
    rows =[[P("<font name='ZapfDingbats' color='white'>4</font>", "cell"), P(f"<b>{t}</b><br/>{escape(d)}", "cell")] for t, d in STRENGTHS]
    ft = Table(rows, colWidths=[0.6 * cm, W - 0.6 * cm])
    ft.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, -1), colors.HexColor(FORTE)), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor(LINE)),
                            ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    s += [ft, CondPageBreak(7 * cm), P("Pontos fracos", "h1"),
          P("Os riscos centrais, do mais para o menos grave.", "muted"), Spacer(1, 4)]
    weak = [
        ("Comandos de arquivo sem escopo (F1, F2, F3)", "media",
         "encrypt_backup apaga qualquer arquivo depois de cifrá-lo; move_file move qualquer arquivo e nem é usado."),
        ("CSP desligada (F4)", "media",
         "Não há segunda barreira: um XSS futuro herdaria todos os comandos IPC."),
        ("Segredos entregues ao JS (F5)", "baixa", "clientSecret da Pluggy e secret da Binance chegam em texto puro ao webview."),
        ("Backup descriptografado esquecido (F6)", "baixa", "restore.db fica no disco sem senha quando a importação é cancelada."),
        ("Supply chain do release (F7)", "baixa", "A chave do updater é passada a actions referenciadas por tag mutável."),
    ]
    wt = Table([[chip(sv), P(f"<b>{t}</b><br/>{d}", "cell")] for t, sv, d in weak], colWidths=[2.4 * cm, W - 2.4 * cm])
    zebra(wt, header=False)
    s += [wt, PageBreak()]

    # d) achados detalhados
    s += [P("Achados detalhados", "h1"),
          P("Tabela por categoria e, em seguida, a ficha de cada achado com trecho do código.", "muted")]
    for c, name in CATS.items():
        fs = sorted((f for f in FINDINGS if f["cat"] == c), key=lambda f: SEV[f["sev"]][0])
        s.append(CondPageBreak(3 * cm))
        s.append(P(f"{c}. {name}", "h2"))
        if not fs:
            s.append(P("Nenhum achado.", "muted"))
            continue
        hdr = [P("<font color='white'><b>Severidade</b></font>", "cell"), P("<font color='white'><b>Arquivo:linha</b></font>", "cell"),
               P("<font color='white'><b>Descrição</b></font>", "cell")]
        t = Table([hdr] + [[chip(f["sev"]), P(f"<font name='Courier' size='7.6'>{escape(f['file'])}:{escape(f['lines'])}</font>", "cell"),
                            P(f"<b>{f['id']}</b> · {escape(f['title'])}", "cell")] for f in fs],
                  colWidths=[2.4 * cm, 5.6 * cm, W - 8 * cm], repeatRows=1)
        zebra(t)
        s.append(t)

    s += [PageBreak(), P("Fichas dos achados", "h1")]
    for f in sorted(FINDINGS, key=lambda f: (SEV[f["sev"]][0], f["id"])):
        head = Table([[chip(f["sev"]), P(f"<b>{f['id']} · {escape(f['title'])}</b>", "h3")]], colWidths=[2.4 * cm, W - 2.4 * cm],
                     style=[("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0)])
        s.append(KeepTogether([
            head,
            P(f"<b>Categoria:</b> {f['cat']}. {CATS[f['cat']]} &nbsp;·&nbsp; <b>Local:</b> "
              f"<font name='Courier' size='8'>{escape(f['file'])}:{escape(f['lines'])}</font>", "muted"),
            Spacer(1, 3), code_block(f["code"], W), Spacer(1, 4),
            P(f"<b>Por que é explorável:</b> {escape(f['why'])}"),
            P(f"<b>Condição de exploração:</b> {escape(f['cond'])}"),
            Spacer(1, 8),
        ]))

    # e) recomendações
    s += [PageBreak(), P("Recomendações priorizadas", "h1")]
    rt = Table([[P("<font color='white'><b>Prioridade</b></font>", "cell"), P("<font color='white'><b>Ação</b></font>", "cell")]] +
               [[Table([[P(f"<b>{p}</b>", "cellb")], [chip(sv)]], style=[("LEFTPADDING", (0, 0), (-1, -1), 0)]),
                 P(f"<b>{t}</b><br/>{escape(d)}", "cell")] for p, sv, t, d in RECS],
               colWidths=[2.6 * cm, W - 2.6 * cm], repeatRows=1)
    zebra(rt)
    s += [rt, Spacer(1, 8),
          P("F8 e F9 são informativas (decisões de projeto) e não viraram issue; ficam como contexto para P6.", "muted")]

    # f) issues
    s += [PageBreak(), P("ISSUES PARA O GITHUB", "h1"),
          P(f"{len(ISSUES)} issues prontas para copiar e colar. F1, F2 e F3 foram agrupados numa issue só (mesma causa e mesma "
            "correção). Copie o texto entre os marcadores.", "muted"), Spacer(1, 6)]
    for i, iss in enumerate(ISSUES, 1):
        md = f"# {iss['title']}\n\n**Labels sugeridas:** {iss['labels']}\n\n{iss['body']}"
        s += [KeepTogether([
              Table([[chip(iss["sev"]), P(f"<b>Issue {i}</b> · {escape(iss['title'])}", "cellb")]], colWidths=[2.4 * cm, W - 2.4 * cm],
                    style=[("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]),
              Spacer(1, 4), code_block(f"--- ISSUE {i} ---\n{md}\n--- FIM ISSUE {i} ---", W)]), Spacer(1, 12)]

    doc.build(s, onFirstPage=on_page, onLaterPages=on_page)
    print(f"ok: {OUT}")


if __name__ == "__main__":
    # autoverificação: toda ficha aponta para categoria/severidade válidas e toda issue cita arquivo:linha
    assert all(f["cat"] in CATS and f["sev"] in SEV for f in FINDINGS)
    assert all(":" in i["body"] and "Critérios de aceite" in i["body"] for i in ISSUES)
    build()
