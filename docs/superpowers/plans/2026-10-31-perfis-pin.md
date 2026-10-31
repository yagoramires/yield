# Perfis (fase 2 de 4: PIN e criptografia) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PIN opcional de 4 dígitos por perfil que criptografa o banco (SQLCipher) e o item do cofre, com limite de tentativas aplicado no Rust, "Esqueci o PIN", backup `.yield` v2 sem texto claro no disco e "Novo perfil → Restaurar de um backup".

**Architecture:** O `tauri-plugin-sql` sai; quatro comandos próprios (`db_load/db_select/db_execute/db_close`, sobre sqlx) abrem os bancos com `PRAGMA key` em toda conexão do pool quando o arquivo é cifrado. O `libsqlite3-sys` vira SQLCipher por feature unification. **"Tem PIN" vem do cabeçalho do arquivo** (≠ `SQLite format 3\0`); o JS nunca vê chave nem PIN depois do desbloqueio: o Rust guarda as chaves do perfil desbloqueado (Argon2id do PIN + sal do `pins.json`) e as solta ao bloquear/trocar. Ligar, trocar e tirar o PIN, e restaurar backup, passam pelo mesmo caminho seguro: `sqlcipher_export` → `<db>.pin-tmp` → `integrity_check` → fsync → rename atômico.

**Tech Stack:** Tauri 2 (Rust), sqlx 0.8 (sqlite) + `libsqlite3-sys` 0.30 com SQLCipher 4.5.7, `argon2`, `aes-gcm`, `keyring`, React 19, Vitest, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-30-onboarding-perfis-design.md` (seções "PIN", "PIN esquecido", "Deixado para quem implementar"; mockup aba 1, 2ª e 4ª telas). Decisões desta fase: `.superpowers/fase2-decisoes.md`. Spike: `.superpowers/spike-sqlcipher.md` (código de referência: `.claude/worktrees/agent-a92f55a29e0c72a67/src-tauri/src/spike_sqlcipher.rs`). Formato: `docs/superpowers/plans/2026-10-30-perfis.md`.

## Global Constraints

- Branch `feat/perfis-pin`. Commits **sem** `Co-Authored-By`. Repositório público: testes só com dados inventados.
- Visual: `card`, `toggle-row`, `switch`, `.modal-bg`/`.modal`, `b`/`b pri`/`b ghost`/`b danger`, ícones lucide-react, **nunca emoji como ícone**, sem `window.confirm`. Textos em pt-BR, no tom das telas atuais.
- Sem migração SQL nova nesta fase. Repositórios (`src/db/*Repo.ts`) e a interface `Db` não mudam.
- PIN = exatamente 4 dígitos ASCII (`valid_pin`). Chave = Argon2id **m=65536 KiB, t=3, p=1, saída 64 bytes**: `[0..32]` banco (chave raw `"x'<64 hex>'"`), `[32..64]` cofre. Sal de 16 bytes por perfil no `pins.json` (pasta de config, só o Rust lê/grava, com `write_atomic`).
- Limite: **5 erros → 60 s; cada nova rodada de 5 erros: 300 s, 900 s, depois 3600 s (fica em 3600)**. Persistido em `pins.json`; nunca apaga dados.
- "Tem PIN" = cabeçalho do arquivo do banco. O `perfis.json` **não** ganha campo de PIN.
- Nada em claro no disco para perfil com PIN em nenhum passo: temporários (`<db>.pin-tmp`, `restore.db`, `export-*.db`) de perfil com PIN são cifrados; o startup apaga `*.pin-tmp`, `*.pin-tmp-journal`, `restore.db` e `export-*.db` da pasta de config.
- Todo `ATTACH` passa `KEY` explícito (`KEY ''` para em claro): sem `KEY`, o SQLCipher usa a chave do `main`.
- Parâmetros JSON → bind **iguais ao plugin** (null → `None::<Value>`, string → `String`, número → `f64`, resto → `Value`); a leitura usa o `to_json` copiado do plugin (com o cabeçalho Apache-2.0/MIT). Outra conversão mudaria o tipo do que já está gravado.
- CI de macOS **nunca** define `OPENSSL_DIR`. `libsqlite3-sys` por alvo: macOS `bundled-sqlcipher`, Windows `bundled-sqlcipher-vendored-openssl`.
- `pnpm test`, `pnpm build` e `cargo test --manifest-path src-tauri/Cargo.toml` verdes ao fim de cada task.

## Review Focus

1. **Quem já usa, sem PIN, depois da troca para SQLCipher:** o `yield.db` gravado pelo SQLite comum abre, lê, grava, continua em claro e legível pelo `sqlite3`; as migrações (vários comandos num `execute`) seguem rodando. Testes: `banco_em_claro_do_sqlite_comum_continua_igual` e `execute_roda_varios_comandos_como_o_plugin` (Task 1).
2. **SQLCipher não linkado → `PRAGMA key` ignorado e banco "com PIN" gravado em claro, sem erro:** Testes: `sqlcipher_esta_linkado` (Task 1), `ligar_pin_nao_deixa_texto_claro` (Task 3; `export_verified` recusa cabeçalho em claro quando há chave).
3. **App fechado no meio de ligar/trocar/tirar o PIN:** o banco fica inteiro (velho ou novo) e abre com o PIN certo daquele estado. Testes: `crash_antes_do_rename_mantem_o_banco_antigo`, `crash_depois_do_rename_vale_o_cabecalho`, `troca_recusa_journal_quente` (Task 3).
4. **Burlar o limite fechando o app ou disparando tentativas em paralelo:** a espera sobrevive a reler o `pins.json`, e o PIN certo durante a espera não abre. Testes: `reiniciar_nao_zera_a_espera`, `pin_certo_durante_a_espera_nao_abre` (Task 2).
5. **Backup de perfil com PIN deixando texto claro no disco** (export, `.yield` v1 restaurado num perfil com PIN, cópias `seguranca-*` antigas). Testes: `backup_de_perfil_com_pin_nao_deixa_texto_claro`, `backup_v1_restaura_em_perfil_com_pin_sem_texto_claro` (Task 4), `ligar_pin_apaga_copias_em_claro_do_perfil` (Task 3).

---

### Task 1: SQLCipher e comandos `db_*` próprios (sem PIN ainda)

**Files:**
- Create: `src-tauri/src/db.rs`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs` (`mod db`; `decrypt_backup` → `backup_open`; `swap_database` sem parâmetro; Builder sem `tauri_plugin_sql`, `.manage(db::Dbs::default())`, `invoke_handler`), `src-tauri/capabilities/default.json` (tira `sql:*`), `package.json` (`pnpm remove @tauri-apps/plugin-sql`), `src/db/client.ts`, `src/db/backup.ts`, `src/db/migrate.ts` (só o comentário que cita o plugin), `src/state/DataProvider.tsx:184`, `src/pages/Configuracoes.tsx` (`validar`, `abrirComSenha`, `escolherBackup`, `swap`, `reopen`), `src/profiles/active.ts` (`releasePrevious`)

**Interfaces:**
- Produces (Rust, `db.rs`):
  - `pub type Key = [u8; 32]`
  - `#[derive(Default)] pub struct Dbs(pub tokio::sync::Mutex<HashMap<String, SqlitePool>>)` — pools por nome de arquivo (o `db` do DataProvider continua valendo depois de fechar e reabrir o mesmo arquivo, como no plugin)
  - `pub fn has_pin_file(path: &Path) -> Result<bool, String>` — `false` se não existe ou tem < 16 bytes; senão `!starts_with(SQLITE_MAGIC)`
  - `fn key_sql(key: Option<&Key>) -> String` — `"\"x'<hex>'\""` ou `"''"` (pragma e `ATTACH ... KEY`)
  - `pub async fn open_pool(path: &Path, key: Option<&Key>) -> Result<SqlitePool, String>` — `SqliteConnectOptions::new().filename(path).create_if_missing(true).foreign_keys(true)` + `.pragma("key", key_sql(..))` com chave; `SqlitePoolOptions::new()` padrão; logo depois `SELECT count(*) FROM sqlite_master` (PIN errado falha aqui, não na primeira tela); com chave, `PRAGMA cipher_version` não vazio, senão `Err`
  - `pub async fn cipher_version() -> Option<String>` — conexão `sqlite::memory:`; `None` se a pragma não devolve linha ou vem vazia
  - `pub async fn select(pool: &SqlitePool, sql: &str, params: Vec<Value>) -> Result<Vec<serde_json::Map<String, Value>>, String>`
  - `pub async fn execute(pool: &SqlitePool, sql: &str, params: Vec<Value>) -> Result<ExecResult, String>`; `#[serde(rename_all = "camelCase")] pub struct ExecResult { rows_affected: u64, last_insert_id: i64 }`
  - `pub async fn close_all(dbs: &Dbs)`
  - Comandos: `db_load(app, state: State<Dbs>, file: String) -> Result<(), String>` (só aceita `file == active().1` ou `file == RESTORE_FILE`; caminho `app_config_dir().join(file)`, como o plugin; fecha e substitui um pool já aberto para o mesmo arquivo; nesta task, arquivo com `has_pin_file` → `Err("Perfil bloqueado: digite o PIN.")`), `db_select(state, file, sql, params) -> Vec<Map>`, `db_execute(state, file, sql, params) -> ExecResult`, `db_close(state, file) -> ()` (pool ausente não é erro; usado ausente em select/execute → `Err("Banco não está aberto.")`), `profile_lock(state) -> ()` (por ora só `close_all`; a Task 2 acrescenta soltar as chaves)
- Produces (Rust, `lib.rs`): `backup_open(app, path: String, password: Option<String>) -> Result<(), String>` — `.yield` com senha → `unseal` para `restore.db`; arquivo que começa com `SQLITE_MAGIC` (backup antigo `.db`, sem senha) → copiado para `restore.db`; outro → `Err("Este arquivo não é um backup do Yield.")`. `swap_database(app) -> Result<String, String>` usa sempre `restore.db` como origem. Saem `decrypt_backup` e o parâmetro `source`.
- Produces (JS):
  - `src/db/client.ts`: `openDb(file: string): Promise<Db>` (`invoke('db_load', { file })`; select/execute/close por `invoke` com `{ file, sql, params: params ?? [] }`); `export const RESTORE_FILE = 'restore.db'`. Sai o `PRAGMA foreign_keys = ON` (vem das opções do pool, em toda conexão).
  - `src/db/backup.ts`: `stageBackup(path: string, password: string | null): Promise<void>` — `backup_open` → `openDb(RESTORE_FILE)` → `validateBackup` → `close` (no `finally`); qualquer erro chama `discard_restore` e relança (erro de abrir vira `BackupError('Este arquivo não é um backup do Yield.')`).
  - `active.ts`: `releasePrevious` chama `ai_stop` e `profile_lock` (no lugar de `plugin:sql|close`).

- [ ] **Step 1: Dependências.** Em `Cargo.toml`: tirar `tauri-plugin-sql`; `sqlx = { version = "0.8", default-features = false, features = ["sqlite", "runtime-tokio", "json", "time"] }`; `libsqlite3-sys = { version = "0.30", features = ["bundled-sqlcipher"] }` na tabela `[target.'cfg(target_os = "macos")'.dependencies]` que já existe e `features = ["bundled-sqlcipher-vendored-openssl"]` na de `cfg(windows)`; `[dev-dependencies] tokio = { version = "1", features = ["macros", "rt-multi-thread"] }`; `opt-level = 3` em `[profile.dev.package.libsqlite3-sys]`, `[profile.dev.package.argon2]` e `[profile.dev.package.blake2]` (o Argon2 de 64 MiB levaria segundos em debug). Confira: `cargo tree -e features -i libsqlite3-sys --manifest-path src-tauri/Cargo.toml` mostra `bundled-sqlcipher` e um só `libsqlite3-sys v0.30.1`.

- [ ] **Step 2: Testes que falham** (`db.rs`, `#[cfg(test)] mod tests`; um `pub(crate) mod testutil` com `tmp(name) -> PathBuf` canonicalizado, `MARKER = "SEGREDO_PLAINTEXT_MARKER_42"`, `file_has(path, needle) -> bool`, `is_plain_header(path) -> bool`, reaproveitado pelas Tasks 2–4):

```rust
#[cfg(any(target_os = "macos", windows))]
#[tokio::test]
async fn sqlcipher_esta_linkado() {
    assert!(!cipher_version().await.unwrap_or_default().is_empty());
}

#[cfg(target_os = "macos")] // o sqlite3 do sistema é o SQLite comum, como o do plugin que gravou o yield.db de quem já usa
#[tokio::test]
async fn banco_em_claro_do_sqlite_comum_continua_igual() {
    let db = tmp("plain").join("yield.db");
    assert!(std::process::Command::new("/usr/bin/sqlite3").arg(&db)
        .arg(format!("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES ('{MARKER}');"))
        .status().unwrap().success());
    let pool = open_pool(&db, None).await.unwrap();
    assert_eq!(select(&pool, "SELECT v FROM t", vec![]).await.unwrap()[0]["v"], MARKER);
    let mut held = Vec::new(); // 4 conexões ao mesmo tempo
    for _ in 0..4 { held.push(pool.acquire().await.unwrap()); }
    drop(held);
    execute(&pool, "INSERT INTO t (v) VALUES (?)", vec![json!("escrito-pelo-sqlcipher")]).await.unwrap();
    pool.close().await;
    assert!(is_plain_header(&db));
    let out = std::process::Command::new("/usr/bin/sqlite3").arg(&db).arg("SELECT count(*) FROM t; PRAGMA integrity_check;").output().unwrap();
    assert_eq!(String::from_utf8_lossy(&out.stdout), "2\nok\n");
}

#[tokio::test]
async fn execute_roda_varios_comandos_como_o_plugin() {
    let pool = open_pool(&tmp("multi").join("m.db"), None).await.unwrap();
    execute(&pool, "BEGIN;\nCREATE TABLE a (x);\nCREATE TABLE b (y);\nCOMMIT;", vec![]).await.unwrap();
    let n = select(&pool, "SELECT count(*) AS n FROM sqlite_master WHERE name IN ('a','b')", vec![]).await.unwrap();
    assert_eq!(n[0]["n"], 2);
}

#[tokio::test]
async fn bind_e_leitura_iguais_ao_plugin() {
    let pool = open_pool(&tmp("tipos").join("t.db"), None).await.unwrap();
    execute(&pool, "CREATE TABLE t (a TEXT, b TEXT, c REAL, d INTEGER)", vec![]).await.unwrap();
    let r = execute(&pool, "INSERT INTO t VALUES (?, ?, ?, ?)", vec![json!(null), json!("t"), json!(1.5), json!(2)]).await.unwrap();
    assert_eq!((r.rows_affected, r.last_insert_id), (1, 1));
    assert_eq!(serde_json::to_value(select(&pool, "SELECT * FROM t", vec![]).await.unwrap()).unwrap(), json!([{ "a": null, "b": "t", "c": 1.5, "d": 2 }]));
}
```

- [ ] **Step 3: Rodar e ver falhar:** `cargo test --manifest-path src-tauri/Cargo.toml db::` → FAIL de compilação (`open_pool` etc. não existem).

- [ ] **Step 4: Implementar** `db.rs`, os comandos em `lib.rs` e o JS do bloco Interfaces. `Configuracoes.tsx`: `validar`/`abrirComSenha`/`escolherBackup` passam por `stageBackup(path, password | null)`; `swap: () => invoke<string>('swap_database')`; `reopen` com `openDb(dbFile)`. `DataProvider`: `openDb(dbFile)`. Capabilities: tirar `sql:default`, `sql:allow-execute`, `sql:allow-close`.

- [ ] **Step 5: Rodar tudo:** `pnpm test && pnpm build && cargo test --manifest-path src-tauri/Cargo.toml` → PASS

- [ ] **Step 6: Verificar no app** (`pnpm tauri dev`) com os seus dados: abre igual, sincroniza a Pluggy, cria e apaga perfil, troca de perfil, exporta e importa um backup `.yield` e um `.db` antigo. `head -c 16 yield.db` continua `SQLite format 3`.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/db.rs src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json pnpm-lock.yaml src/db/client.ts src/db/backup.ts src/db/migrate.ts src/state/DataProvider.tsx src/pages/Configuracoes.tsx src/profiles/active.ts
git commit -m "feat(perfis): SQLCipher e comandos de banco próprios no lugar do plugin SQL"
```

---

### Task 2: `pins.json`, chave do PIN e desbloqueio com limite de tentativas

**Files:**
- Create: `src-tauri/src/pin.rs`
- Modify: `src-tauri/src/db.rs` (`key_opens`; `db_load` pega a chave de `pin::key_for`), `src-tauri/src/lib.rs` (`mod pin`; `profile_activate` solta as chaves de outro perfil; `invoke_handler`)

**Interfaces:**
- Consumes: `db::{Key, open_pool, has_pin_file, close_all, Dbs}`, `write_atomic`, `valid_profile`, `active()`, `RESTORE_FILE`, `VAULT` (lib.rs)
- Produces (`pin.rs`):
  - `#[derive(Clone)] pub struct Keys { pub db: Key, pub vault: Key }`
  - `pub fn valid_pin(pin: &str) -> bool`
  - `pub fn derive(pin: &str, salt: &[u8; 16]) -> Result<Keys, String>` — `Argon2::new(Algorithm::Argon2id, Version::V0x13, Params::new(65536, 3, 1, Some(64))?)`
  - `pub const PINS_FILE: &str = "pins.json"`, `const PER_ROUND: u32 = 5`, `const WAITS: [u64; 4] = [60, 300, 900, 3600]`
  - `#[derive(Serialize, Deserialize, Default)] pub struct PinsFile { pub version: u32, pub profiles: BTreeMap<String, PinState> }`
  - `#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)] pub struct PinState { pub salt: String /* 32 hex */, pub fails: u32, pub until: u64 /* unix s; 0 = sem espera */ }`
  - `pub fn read_pins(dir: &Path) -> Result<PinsFile, String>` — ausente → padrão; ilegível → grava cópia `pins.json.ilegivel-<secs>` e `Err("O arquivo pins.json está ilegível; o PIN não pode ser conferido.")` (nunca vira padrão: perderia os sais)
  - `pub fn write_pins(dir: &Path, f: &PinsFile) -> Result<(), String>` (com `write_atomic`)
  - **Cópia do sal (decisão do usuário: perder o `pins.json` não pode trancar os perfis):** `pub fn salt_copy(dir: &Path, db_file: &str) -> PathBuf` → `<dir>/<db_file>.salt`; `pub fn write_salt_copy(dir: &Path, db_file: &str, salt: &[u8; 16]) -> Result<(), String>` (32 hex, `write_atomic`); `pub fn read_salt_copy(dir: &Path, db_file: &str) -> Option<[u8; 16]>`. Sempre que um sal é gravado no `pins.json`, a cópia é gravada também (antes do swap). `check_pin_in`: sem entrada no `pins.json` (ou `pins.json` ausente) mas com `<db_file>.salt` válido → usa a cópia e recria a entrada com `fails = 0, until = 0`. O sal não é segredo; a cópia não enfraquece nada.
  - `pub fn locked_until(s: &PinState, now: u64) -> Option<u64>` — `Some(until)` se `until > now`
  - `pub fn register_failure(s: &mut PinState, now: u64) -> Unlock` — `fails += 1`; múltiplo de 5 → `until = now + WAITS[min(fails/5 - 1, 3)]` e `Locked { until }`; senão `Wrong { remaining: 5 - fails % 5 }`
  - `#[derive(Serialize, PartialEq, Debug)] #[serde(tag = "kind", rename_all = "camelCase")] pub enum Unlock { Ok, Wrong { remaining: u32 }, Locked { until: u64 } }` → JSON `{kind:'ok'}`, `{kind:'wrong',remaining}`, `{kind:'locked',until}`
  - `pub async fn check_pin_in(dir: &Path, id: &str, db_file: &str, pin: &str, now: u64) -> Result<(Unlock, Option<Keys>), String>` — valida par e PIN (`Err("O PIN tem 4 dígitos.")`); segura `static CHECKING: tokio::sync::Mutex<()>` do começo ao fim (tentativas em paralelo contam uma a uma); sem entrada para o perfil → `Err("Não encontrei o sal do PIN deste perfil em pins.json; sem ele o banco não abre.")`; em espera → `Locked` sem rodar o Argon2; Argon2 em `spawn_blocking`; `key_opens` → certo: zera `fails`/`until`, grava, `(Ok, Some(keys))`; errado: `register_failure`, **grava antes de responder**
  - `static UNLOCKED: Mutex<Option<(String, Keys)>>`, `static RESTORE: Mutex<Option<Key>>` (Task 4 preenche)
  - `pub fn key_for(dir: &Path, file: &str) -> Result<Option<Key>, String>` — em claro → `None`; `RESTORE_FILE` → `RESTORE`; arquivo do perfil ativo com `UNLOCKED` do mesmo id → `Some(db)`; senão `Err("Perfil bloqueado: digite o PIN.")`
  - `pub fn vault_key_for(id: &str) -> Option<Key>`
  - Comandos: `pin_supported() -> bool` (`cipher_version().is_some()`, calculado uma vez num `tokio::sync::OnceCell`), `profiles_locks(app, profiles: Vec<ProfileRef>) -> HashMap<String, PinInfo>` (`#[serde(rename_all = "camelCase")] ProfileRef { id, db_file }`; par inválido fica de fora; `PinInfo { has_pin: bool, until: Option<u64> }` camelCase, `until` só se em espera), `profile_unlocked(id) -> bool`, `profile_unlock(app, id, db_file, pin) -> Result<Unlock, String>` (em `Ok`, grava `UNLOCKED`), `profile_lock` passa a também zerar `UNLOCKED`, `RESTORE` e o cache `VAULT`
- Produces (`db.rs`): `pub async fn key_opens(path: &Path, key: &Key) -> Result<bool, String>` — uma conexão só; erro SQLite 26 (`SQLITE_NOTADB`) → `Ok(false)`; outro erro → `Err`

- [ ] **Step 1: Testes que falham** (`pin.rs`). Crie em `pin.rs` um `#[cfg(test)] pub(crate) mod testutil` (as Tasks 3 e 4 usam) com `pub const SALT: [u8; 16] = *b"sal-de-teste-16b"`, `em_claro(db_file) -> PathBuf` (pasta nova com o banco em claro e a tabela `t(v)` com `MARKER`) e `cifrado(db_file, pin) -> PathBuf` (o mesmo, criado com `open_pool(path, Some(&derive(pin, &SALT)?.db))`, mais a entrada do perfil com `SALT` no `pins.json`). `pub fn hex(b: &[u8]) -> String` fica no módulo principal (o `pins.json` usa).

```rust

#[test]
fn espera_cresce_a_cada_rodada_de_5_erros() {
    let mut s = PinState { salt: "00".repeat(16), fails: 0, until: 0 };
    for r in [4, 3, 2, 1] { assert_eq!(register_failure(&mut s, 1000), Unlock::Wrong { remaining: r }); }
    assert_eq!(register_failure(&mut s, 1000), Unlock::Locked { until: 1060 });
    assert_eq!((locked_until(&s, 1059), locked_until(&s, 1060)), (Some(1060), None));
    let mut wait = |s: &mut PinState| { for _ in 0..4 { register_failure(s, 2000); } register_failure(s, 2000) };
    assert_eq!(wait(&mut s), Unlock::Locked { until: 2300 });
    assert_eq!(wait(&mut s), Unlock::Locked { until: 2900 });
    assert_eq!(wait(&mut s), Unlock::Locked { until: 5600 });
    assert_eq!(wait(&mut s), Unlock::Locked { until: 5600 }); // fica em 1 h
}

#[test]
fn chave_do_pin() {
    let a = derive("1234", &SALT).unwrap();
    assert_eq!(a.db, derive("1234", &SALT).unwrap().db);
    assert_ne!(a.db, a.vault);
    assert_ne!(a.db, derive("1235", &SALT).unwrap().db);
    assert!(valid_pin("0000") && !valid_pin("123") && !valid_pin("12345") && !valid_pin("12a4") && !valid_pin("١٢٣٤"));
}

#[tokio::test]
async fn reiniciar_nao_zera_a_espera() {
    let dir = cifrado("perfil-abcd1234.db", "1234"); // helper: banco cifrado + entrada no pins.json com SALT
    for _ in 0..4 { assert!(matches!(check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "9999", 1000).await.unwrap().0, Unlock::Wrong { .. })); }
    assert_eq!(check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "9999", 1000).await.unwrap().0, Unlock::Locked { until: 1060 });
    // "reiniciar": o estado vem de novo do disco
    assert_eq!(read_pins(&dir).unwrap().profiles["abcd1234"], PinState { salt: hex(&SALT), fails: 5, until: 1060 });
}

#[tokio::test]
async fn pin_certo_durante_a_espera_nao_abre() {
    let dir = cifrado("perfil-abcd1234.db", "1234");
    for _ in 0..5 { check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "9999", 1000).await.unwrap(); }
    let (r, keys) = check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "1234", 1030).await.unwrap();
    assert_eq!((r, keys.is_none()), (Unlock::Locked { until: 1060 }, true));
    let (r, keys) = check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "1234", 1060).await.unwrap();
    assert_eq!((r, keys.is_some()), (Unlock::Ok, true));
    assert_eq!(read_pins(&dir).unwrap().profiles["abcd1234"].fails, 0);
}

#[tokio::test]
async fn sem_pins_json_o_sal_vem_da_copia() {
    let dir = cifrado("perfil-abcd1234.db", "1234"); // o helper grava pins.json e a cópia <db>.salt
    std::fs::remove_file(dir.join(PINS_FILE)).unwrap();
    let (r, keys) = check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "1234", 1000).await.unwrap();
    assert_eq!((r, keys.is_some()), (Unlock::Ok, true));
    assert_eq!(read_pins(&dir).unwrap().profiles["abcd1234"].salt, hex(&SALT));
}

#[tokio::test]
async fn pin_errado_nao_toca_no_banco_e_pins_ilegivel_nao_vira_padrao() {
    let dir = cifrado("perfil-abcd1234.db", "1234");
    let antes = std::fs::read(dir.join("perfil-abcd1234.db")).unwrap();
    check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "9999", 1000).await.unwrap();
    assert_eq!(std::fs::read(dir.join("perfil-abcd1234.db")).unwrap(), antes);
    assert!(check_pin_in(&dir, "abcd1234", "yield.db", "1234", 1000).await.is_err());
    std::fs::write(dir.join(PINS_FILE), "{lixo").unwrap();
    assert!(read_pins(&dir).is_err());
    assert!(std::fs::read_dir(&dir).unwrap().flatten().any(|e| e.file_name().to_string_lossy().starts_with("pins.json.ilegivel-")));
}
```

- [ ] **Step 2: Rodar e ver falhar:** `cargo test --manifest-path src-tauri/Cargo.toml pin::` → FAIL de compilação

- [ ] **Step 3: Implementar** `pin.rs` e as mudanças em `db.rs`/`lib.rs`. Hex à mão, como o `hmac_hex` (sem crate nova); sal com `OsRng.fill_bytes`. Registrar `pin_supported`, `profiles_locks`, `profile_unlocked`, `profile_unlock`.

- [ ] **Step 4: Rodar:** `pnpm test && pnpm build && cargo test --manifest-path src-tauri/Cargo.toml` → PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pin.rs src-tauri/src/db.rs src-tauri/src/lib.rs
git commit -m "feat(perfis): chave do PIN, pins.json e desbloqueio com limite de tentativas no Rust"
```

---

### Task 3: Ligar, trocar e tirar o PIN (troca segura contra crash, cofre cifrado)

**Files:**
- Modify: `src-tauri/src/db.rs` (export, commit, limpeza), `src-tauri/src/pin.rs` (comandos), `src-tauri/src/lib.rs` (cofre: `seal_vault`/`open_vault`/`reseal_vault`, `load_cached`, `update_vault`; `remove_profile_in` e `profile_remove_files`; `setup` chama `cleanup_pin_tmp`)

**Interfaces:**
- Consumes: Tasks 1–2 (`open_pool`, `key_opens`, `check_pin_in`, `derive`, `read_pins`/`write_pins`, `UNLOCKED`, `vault_key_for`, `Dbs`), `is_safety_copy_of`, `seal`-style AES-GCM de `lib.rs`
- Produces (`db.rs`):
  - `pub fn pin_tmp(dir: &Path, db_file: &str) -> PathBuf` → `<dir>/<db_file>.pin-tmp`
  - `pub async fn export_verified(from: &Path, from_key: Option<&Key>, to: &Path, to_key: Option<&Key>) -> Result<(), String>` — apaga `to` se existir; uma conexão em `from` (desfaz `-journal` quente); `ATTACH '<to>' AS dst KEY <key_sql(to_key)>`, `SELECT sqlcipher_export('dst')`, `DETACH`; fecha; reabre `to` com `to_key` e exige `PRAGMA integrity_check` = `ok`; com `to_key`, cabeçalho em claro → apaga `to` e `Err("A criptografia do banco não está ativa nesta instalação; nada foi alterado.")`; `fsync(to)`. Erro em qualquer passo apaga `to`.
  - `pub fn commit_swap(dir: &Path, db_file: &str, tmp: &Path) -> Result<(), String>` — `<db>-journal` ou `<db>-wal` existe → `Err` (seria aplicado sobre o arquivo novo); `rename(tmp, db)`; `fsync` do diretório (`#[cfg(unix)]`)
  - `pub fn cleanup_pin_tmp(dir: &Path)` — apaga nomes que terminam em `.pin-tmp` ou `.pin-tmp-journal`
- Produces (`pin.rs`):
  - `pub async fn rekey_in(dir: &Path, db_file: &str, from: Option<&Key>, to: Option<&Key>) -> Result<(), String>` = `export_verified(db, from, pin_tmp, to)` + `commit_swap`
  - `pub fn remove_plain_safety_copies(dir: &Path, db_file: &str) -> Result<(), String>` — apaga os `seguranca-*` de `is_safety_copy_of(_, db_file)` (inclui as legadas `seguranca-<digits>.db*` do `yield.db`)
  - Comandos (todos exigem `id == active().0` e `valid_profile`; fecham o pool do arquivo em `Dbs` antes e **reabrem** depois com a chave do estado final, também em erro — o `db` do DataProvider segue funcionando):
    - `profile_set_pin(app, state, id, db_file, pin) -> Result<(), String>` — `pin_supported` falso → `Err("PIN indisponível nesta instalação: o Yield não encontrou a criptografia do banco (SQLCipher).")`; já tem PIN → `Err("Este perfil já tem PIN.")`. Ordem: sal (o que já existe no `pins.json` ou novo) **gravado antes**, `fails = 0` → `derive` → `rekey_in(None → db)` → `UNLOCKED` → `reseal_vault(None, Some(vault))` → `remove_plain_safety_copies`
    - `profile_change_pin(app, state, id, db_file, current, next) -> Result<Unlock, String>` — `current` por `check_pin_in` (conta no limite; `Wrong`/`Locked` voltam sem mexer em nada); mesmo sal; `reseal_vault(old, None)` → `rekey_in(old → new)` → `UNLOCKED` novo → `reseal_vault(None, new)`
    - `profile_remove_pin(app, state, id, db_file, current) -> Result<Unlock, String>` — `check_pin_in`; `reseal_vault(old, None)` → `rekey_in(old → None)` → `UNLOCKED = None` → tira a entrada do `pins.json`
- Produces (`lib.rs`):
  - `const VAULT_SEALED: &str = "pin1:"`; `fn seal_vault(json: &str, key: &Key) -> Result<String, String>` → `"pin1:" + hex(nonce(12) || AES-256-GCM(json))`; `fn open_vault(raw: &str, key: Option<&Key>) -> Result<Vault, String>` — sem prefixo: como hoje (ilegível = vazio); com prefixo e sem chave → `Err("Perfil bloqueado: digite o PIN.")`; chave errada → `Err` (nunca vira vazio)
  - `load_cached`: usa `open_vault(raw, vault_key_for(&perfil))`; item em claro com o perfil desbloqueado → regrava cifrado na hora (sobra de crash no meio de ligar/trocar). `update_vault` grava `seal_vault` quando `vault_key_for(ativo)` existe.
  - `fn reseal_vault(from: Option<&Key>, to: Option<&Key>) -> Result<(), String>` — lê o item do perfil ativo com `from`, grava com `to` (sem item: nada), atualiza o cache `VAULT`
  - `remove_profile_in` apaga também `<db_file>.pin-tmp` e `<db_file>.salt`; `profile_remove_files` tira a entrada do perfil do `pins.json`; `profile_remove_pin` apaga `<db_file>.salt` depois do swap

- [ ] **Step 1: Testes que falham** (`pin.rs`, com `pin::testutil` da Task 2):

```rust
#[tokio::test]
async fn ligar_pin_nao_deixa_texto_claro() {
    let dir = em_claro("perfil-abcd1234.db");
    let k = derive("1234", &SALT).unwrap();
    rekey_in(&dir, "perfil-abcd1234.db", None, Some(&k.db)).await.unwrap();
    let db = dir.join("perfil-abcd1234.db");
    assert!(!is_plain_header(&db) && !file_has(&db, MARKER) && !file_has(&db, "CREATE TABLE"));
    assert!(!key_opens(&db, &derive("9999", &SALT).unwrap().db).await.unwrap());
    let pool = open_pool(&db, Some(&k.db)).await.unwrap();
    assert_eq!(select(&pool, "SELECT v FROM t", vec![]).await.unwrap()[0]["v"], MARKER);
    assert!(!pin_tmp(&dir, "perfil-abcd1234.db").exists());
}

#[tokio::test]
async fn trocar_e_tirar_o_pin() {
    let dir = cifrado("perfil-abcd1234.db", "1234");
    let (a, b) = (derive("1234", &SALT).unwrap(), derive("5678", &SALT).unwrap());
    let db = dir.join("perfil-abcd1234.db");
    rekey_in(&dir, "perfil-abcd1234.db", Some(&a.db), Some(&b.db)).await.unwrap();
    assert!(!key_opens(&db, &a.db).await.unwrap() && key_opens(&db, &b.db).await.unwrap());
    rekey_in(&dir, "perfil-abcd1234.db", Some(&b.db), None).await.unwrap();
    assert!(is_plain_header(&db) && file_has(&db, MARKER));
}

#[tokio::test]
async fn crash_antes_do_rename_mantem_o_banco_antigo() {
    let dir = em_claro("perfil-abcd1234.db");
    let k = derive("1234", &SALT).unwrap();
    let tmp = pin_tmp(&dir, "perfil-abcd1234.db");
    export_verified(&dir.join("perfil-abcd1234.db"), None, &tmp, Some(&k.db)).await.unwrap(); // "crash" aqui
    cleanup_pin_tmp(&dir); // próximo startup
    assert!(!tmp.exists());
    assert!(is_plain_header(&dir.join("perfil-abcd1234.db")) && file_has(&dir.join("perfil-abcd1234.db"), MARKER));
}

#[tokio::test]
async fn crash_depois_do_rename_vale_o_cabecalho() {
    let dir = em_claro("perfil-abcd1234.db");
    let mut f = PinsFile::default();
    f.profiles.insert("abcd1234".into(), PinState { salt: hex(&SALT), fails: 0, until: 0 }); // sal gravado antes do swap
    write_pins(&dir, &f).unwrap();
    rekey_in(&dir, "perfil-abcd1234.db", None, Some(&derive("1234", &SALT).unwrap().db)).await.unwrap(); // "crash": cofre não regravado
    assert!(has_pin_file(&dir.join("perfil-abcd1234.db")).unwrap());
    assert_eq!(check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "1234", 1000).await.unwrap().0, Unlock::Ok);
}

#[tokio::test]
async fn troca_recusa_journal_quente() {
    let dir = em_claro("perfil-abcd1234.db");
    let tmp = pin_tmp(&dir, "perfil-abcd1234.db");
    export_verified(&dir.join("perfil-abcd1234.db"), None, &tmp, Some(&derive("1234", &SALT).unwrap().db)).await.unwrap();
    std::fs::write(dir.join("perfil-abcd1234.db-journal"), "x").unwrap();
    assert!(commit_swap(&dir, "perfil-abcd1234.db", &tmp).is_err());
    assert!(is_plain_header(&dir.join("perfil-abcd1234.db")));
}

#[test]
fn ligar_pin_apaga_copias_em_claro_do_perfil() {
    let dir = tmp("pin-copias");
    let dele = ["seguranca-perfil-abcd1234-1793000000.db", "seguranca-perfil-abcd1234-1793000000.db-wal"];
    let ficam = ["seguranca-yield-1793000000.db", "seguranca-1700000000.db", "seguranca-perfil-zzzz9999-1793000000.db"];
    for f in dele.iter().chain(&ficam) { std::fs::write(dir.join(f), "x").unwrap(); }
    remove_plain_safety_copies(&dir, "perfil-abcd1234.db").unwrap();
    assert!(dele.iter().all(|f| !dir.join(f).exists()) && ficam.iter().all(|f| dir.join(f).exists()));
    remove_plain_safety_copies(&dir, "yield.db").unwrap(); // o principal leva também as legadas sem stem
    assert!(!dir.join("seguranca-1700000000.db").exists() && dir.join("seguranca-perfil-zzzz9999-1793000000.db").exists());
}
```

Em `lib.rs`:

```rust
#[test]
fn cofre_cifrado_so_abre_com_a_chave_do_pin() {
    let (k, outra) = ([7u8; 32], [8u8; 32]);
    let raw = seal_vault(r#"{"pluggy":{"clientId":"id","clientSecret":"segredo"}}"#, &k).unwrap();
    assert!(raw.starts_with("pin1:") && !raw.contains("segredo") && !raw.contains("clientSecret"));
    assert_eq!(open_vault(&raw, Some(&k)).unwrap().pluggy.unwrap().client_secret, "segredo");
    assert!(open_vault(&raw, None).is_err() && open_vault(&raw, Some(&outra)).is_err());
    assert!(open_vault(r#"{"binance":{"apiKey":"a","secret":"b"}}"#, None).unwrap().binance.is_some()); // item de antes do PIN
}
```

E acrescente ao `remover_perfil_apaga_so_os_arquivos_dele` um `perfil-abcd1234.db.pin-tmp` que precisa sumir.

- [ ] **Step 2: Rodar e ver falhar:** `cargo test --manifest-path src-tauri/Cargo.toml` → FAIL de compilação

- [ ] **Step 3: Implementar** as funções e os três comandos do bloco Interfaces; registrar no `invoke_handler`; `setup` chama `db::cleanup_pin_tmp(&config_dir)`.

- [ ] **Step 4: Rodar:** `pnpm test && pnpm build && cargo test --manifest-path src-tauri/Cargo.toml` → PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/pin.rs src-tauri/src/lib.rs
git commit -m "feat(perfis): ligar, trocar e tirar PIN com troca segura do banco e cofre cifrado"
```

---

### Task 4: Backup `.yield` v2 (exportar e restaurar sem texto claro)

**Files:**
- Create: `src/pages/configuracoes/BackupExport.tsx`
- Modify: `src-tauri/src/lib.rs` (`seal`/`unseal` com versão, `backup_export`, `backup_open`, `swap_database` → `restore_into`, `check_export` → `check_dest`, sai `encrypt_backup`, `is_encrypted_backup` aceita v1 e v2, `discard_restore` zera `RESTORE`, limpeza de `export-*.db` na pasta de config), `src-tauri/src/db.rs` (`stage_plain`), `src/db/backup.ts` (sai `exportBackup`), `src/db/backup.test.ts` (sai o teste de `exportBackup`), `src/pages/Configuracoes.tsx` (usa `BackupExport`)

**Interfaces:**
- Consumes: `export_verified`, `commit_swap`, `pin_tmp`, `open_pool`, `UNLOCKED`, `RESTORE`, `has_pin_file`, `Dbs`, `stageBackup` (Task 1)
- Produces (Rust):
  - `const BACKUP_MAGIC_V2: &[u8; 8] = b"YIELDBK2"`. `fn seal(magic: &[u8; 8], plain: &[u8], password: &str) -> Result<Vec<u8>, String>`; `fn unseal(data: &[u8], password: &str) -> Result<(u8 /* 1 | 2 */, Vec<u8>), String>`. Payload v2 = `chave efêmera (32) || arquivo SQLCipher`. Mensagens de erro de hoje mantidas.
  - `async fn export_bytes(pool: &SqlitePool, tmp: &Path, eph: Option<&Key>) -> Result<Vec<u8>, String>` — numa conexão do pool: `ATTACH tmp AS bk KEY <key_sql(eph)>`, `sqlcipher_export('bk')`, `DETACH`; lê; **apaga `tmp` sempre**, também em erro
  - `backup_export(app, state, to: String, password: String) -> Result<(), String>` — `check_dest(to)` (`.yield`, novo ou outro backup do Yield); tmp `<config>/export-<ms>.db`; perfil ativo desbloqueado (tem PIN) → chave efêmera aleatória e `seal(V2, eph || bytes)`; sem PIN → `seal(V1, bytes)` (backups de perfil sem PIN continuam abrindo em versões antigas)
  - `async fn stage_restore_in(dir: &Path, data: &[u8], password: Option<&str>) -> Result<Key, String>` — grava `restore.db` **sempre cifrado** com a chave devolvida: v2 → grava o arquivo do payload como está, chave = a efêmera; v1 ou `.db` antigo em claro → `db::stage_plain(bytes, restore.db, &nova_chave)`. Sem senha num `.yield` → `Err("Este backup tem senha.")`
  - `db.rs`: `pub async fn stage_plain(bytes: Vec<u8>, to: &Path, to_key: &Key) -> Result<(), String>` — conexão `sqlite::memory:`, `SqliteConnection::deserialize(None, SqliteOwnedBuf::try_from(&bytes[..])?, false)`, `ATTACH to KEY`, `sqlcipher_export`; o texto claro só existe na memória
  - `backup_open(app, path, password: Option<String>)` passa a usar `stage_restore_in` e grava `RESTORE`
  - `async fn restore_into(dir: &Path, db_file: &str, restore_key: &Key, target_key: Option<&Key>) -> Result<Option<PathBuf>, String>` — banco existe → cópia `seguranca-<stem>-<secs>.db` (+ `-wal`), como o `swap_in_dir` de hoje, e apaga `-wal`/`-shm`; `export_verified(restore.db, restore_key → pin_tmp, target_key)` → `commit_swap` → apaga `restore.db`. Banco não existe → sem cópia, `Ok(None)`
  - `swap_database(app, state) -> Result<Option<String>, String>` — fecha o pool do perfil ativo se aberto; `target_key` = chave do `UNLOCKED` se o banco tem PIN, senão `None`; zera `RESTORE`
- Produces (JS): `<BackupExport onDone(message: string): void onCancel(): void />` — o formulário de senha atual (`backupPasswordError`, "Escolher onde salvar…") chamando `invoke('backup_export', { to, password })`. `Configuracoes.tsx` usa `swap: async () => (await invoke<string | null>('swap_database')) ?? ''`.

- [ ] **Step 1: Testes que falham** (`lib.rs`, com `db::testutil` e `pin::testutil`):

```rust
#[tokio::test]
async fn backup_de_perfil_com_pin_nao_deixa_texto_claro() {
    let dir = cifrado("perfil-abcd1234.db", "1234");
    let k = pin::derive("1234", &SALT).unwrap();
    let pool = db::open_pool(&dir.join("perfil-abcd1234.db"), Some(&k.db)).await.unwrap();
    let (eph, tmp) = ([3u8; 32], dir.join("export-1.db"));
    let bytes = export_bytes(&pool, &tmp, Some(&eph)).await.unwrap();
    assert!(!tmp.exists() && !bytes.windows(MARKER.len()).any(|w| w == MARKER.as_bytes()) && !bytes.starts_with(SQLITE_MAGIC));
    let sealed = seal(BACKUP_MAGIC_V2, &[eph.as_slice(), &bytes].concat(), "senha").unwrap();
    pool.close().await;
    let rk = stage_restore_in(&dir, &sealed, Some("senha")).await.unwrap();
    assert!(!is_plain_header(&dir.join(RESTORE_FILE)) && !file_has(&dir.join(RESTORE_FILE), MARKER));
    restore_into(&dir, "perfil-abcd1234.db", &rk, Some(&k.db)).await.unwrap();
    let db = dir.join("perfil-abcd1234.db");
    assert!(!file_has(&db, MARKER) && db::key_opens(&db, &k.db).await.unwrap());
    assert!(!dir.join(RESTORE_FILE).exists() && !db::pin_tmp(&dir, "perfil-abcd1234.db").exists());
}

#[tokio::test]
async fn backup_v1_restaura_em_perfil_com_pin_sem_texto_claro() {
    let origem = em_claro("yield.db");
    let v1 = seal(BACKUP_MAGIC, &std::fs::read(origem.join("yield.db")).unwrap(), "senha").unwrap(); // .yield das versões atuais
    let dir = cifrado("perfil-abcd1234.db", "1234");
    let rk = stage_restore_in(&dir, &v1, Some("senha")).await.unwrap();
    assert!(!is_plain_header(&dir.join(RESTORE_FILE)) && !file_has(&dir.join(RESTORE_FILE), MARKER));
    let k = pin::derive("1234", &SALT).unwrap();
    restore_into(&dir, "perfil-abcd1234.db", &rk, Some(&k.db)).await.unwrap();
    let pool = db::open_pool(&dir.join("perfil-abcd1234.db"), Some(&k.db)).await.unwrap();
    assert_eq!(db::select(&pool, "SELECT v FROM t", vec![]).await.unwrap()[0]["v"], MARKER);
}

#[tokio::test]
async fn backup_sem_pin_continua_v1_e_restaura_em_claro() {
    let dir = em_claro("yield.db");
    let pool = db::open_pool(&dir.join("yield.db"), None).await.unwrap();
    let bytes = export_bytes(&pool, &dir.join("export-2.db"), None).await.unwrap();
    pool.close().await;
    assert!(bytes.starts_with(SQLITE_MAGIC));
    let rk = stage_restore_in(&dir, &seal(BACKUP_MAGIC, &bytes, "s").unwrap(), Some("s")).await.unwrap();
    assert!(restore_into(&dir, "yield.db", &rk, None).await.unwrap().is_some()); // cópia de segurança
    assert!(is_plain_header(&dir.join("yield.db")) && file_has(&dir.join("yield.db"), MARKER));
}

#[tokio::test]
async fn restaurar_db_antigo_sem_senha_e_em_perfil_sem_arquivo() {
    let origem = em_claro("velho.db");
    let dir = tmp("restaura-novo");
    let rk = stage_restore_in(&dir, &std::fs::read(origem.join("velho.db")).unwrap(), None).await.unwrap();
    assert_eq!(restore_into(&dir, "perfil-novo12345.db", &rk, None).await.unwrap(), None);
    assert!(file_has(&dir.join("perfil-novo12345.db"), MARKER));
    assert_eq!(stage_restore_in(&dir, b"isto nao e banco nenhum......", None).await.unwrap_err(), "Este arquivo não é um backup do Yield.");
    let v1 = seal(BACKUP_MAGIC, b"x", "boa").unwrap();
    assert_eq!(stage_restore_in(&dir, &v1, Some("ruim")).await.unwrap_err(), "Senha errada ou arquivo corrompido.");
}
```

Adapte: `backup_com_senha_volta_so_com_a_senha_certa` ao `seal(magic, ..)`/`unseal -> (versão, bytes)`; `swap_troca_o_banco_e_guarda_copia_de_seguranca` a `restore_into` (o banco antigo pode seguir sendo texto falso: ele só é copiado; o `restore.db` precisa ser real, via `stage_restore_in`); `caminhos_do_webview_sao_conferidos` a `check_dest`.

- [ ] **Step 2: Rodar e ver falhar:** `cargo test --manifest-path src-tauri/Cargo.toml` → FAIL de compilação

- [ ] **Step 3: Implementar** Rust e JS do bloco Interfaces. Em `backup.test.ts`, tire o teste "exportar sobre arquivo existente" (agora coberto no Rust); `validateBackup` fica.

- [ ] **Step 4: Rodar:** `pnpm test && pnpm build && cargo test --manifest-path src-tauri/Cargo.toml` → PASS

- [ ] **Step 5: Verificar no app:** exportar e importar no perfil sem PIN (o `.yield` começa com `YIELDBK1`); importar um `.yield` gerado pela versão anterior e um `.db` antigo; durante a importação, `head -c 16 restore.db` não é `SQLite format 3`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/db.rs src/db/backup.ts src/db/backup.test.ts src/pages/Configuracoes.tsx src/pages/configuracoes/BackupExport.tsx
git commit -m "feat(perfis): backup .yield v2 para perfil com PIN, restauração sem texto claro no disco"
```

---

### Task 5: Teclado do PIN, espera, cadeado e "Esqueci o PIN"

**Files:**
- Create: `src/profiles/pin.ts`, `src/profiles/pin.test.ts`, `src/profiles/PinPad.tsx`, `src/profiles/ForgotPin.tsx`
- Modify: `src/profiles/Gate.tsx`, `src/profiles/Picker.tsx`, `src/profiles/ProfileSwitcher.tsx`, `src/profiles/DeleteProfileDialog.tsx` (props em vez de `useData`/`useProfiles`), `src/pages/configuracoes/Perfil.tsx` (passa as props), `src/profiles/profiles.ts` + `profiles.test.ts` (`withFallback`), `src/theme.css` (`.pin-*`, nos dois temas)

**Interfaces:**
- Consumes: comandos `profiles_locks`, `profile_unlocked`, `profile_unlock`, `profile_lock` (Task 2); `deleteActive`, `lockToPicker`, `switchTo` (fase 1)
- Produces:
  - `pin.ts`: `type Unlock = { kind: 'ok' } | { kind: 'wrong'; remaining: number } | { kind: 'locked'; until: number }`; `interface PinInfo { hasPin: boolean; until: number | null }`; `pinKey(cur: string, key: string): string`; `formatWait(secs: number): string`; `unlockMessage(u: Unlock): string | null`; `nowSecs(): number`; wrappers `profileLocks(ps: Profile[]): Promise<Record<string, PinInfo>>`, `unlock(p: Profile, pin: string): Promise<Unlock>`
  - `profiles.ts`: `withFallback(profiles: Profile[], now: string, randomId: () => string): Profile[]` — com um perfil só, acrescenta `newProfile({ name: DEFAULT_NAME, color: PROFILE_COLORS[0], avatar: null }, ...)`; senão devolve a mesma lista
  - `<PinPad title: string; profile?: Profile; until?: number | null; message?: string | null; onComplete(pin: string): void | Promise<void>; onBack?(): void; footer?: ReactNode />` — 4 bolinhas (`aria-live` com "N de 4 dígitos"), teclado 1–9 / "Voltar" (só com `onBack`) / 0 / apagar (`Delete`, `aria-label="Apagar dígito"`), teclado físico via `keydown` na janela com `pinKey`; no 4º dígito chama `onComplete` e limpa; com `until > agora`: teclado desligado, "Muitas tentativas erradas. Tente de novo em {formatWait}" atualizando por segundo; `message` embaixo das bolinhas
  - `<ForgotPin profile onBack(): void onDelete(): void />` — texto: **"Sem o PIN, os dados deste perfil não têm como ser abertos, nem pelo Yield. Dá para apagar este perfil e, se você tiver um backup, criar um perfil novo em "Novo perfil" → "Restaurar de um backup"."**, botões "Voltar ao PIN" e "Apagar este perfil…" (`b danger`)
  - `<DeleteProfileDialog profile profiles: Profile[] close(): Promise<void> onCancel(): void onDeleted(next: Profile): void />` (o `next` é o primeiro da lista sem o perfil)
  - `Gate`: novo estado `{ kind: 'pin'; file: ProfilesFile; profile: Profile; until: number | null }`. Depois de escolher o perfil: `locks[id].hasPin && !profile_unlocked(id)` → `PinPad` (título = nome do perfil, com avatar; "Voltar" = `lockToPicker()` só com 2+ perfis; link "Esqueci o PIN"); `Ok` → `profile_activate` → `ready`. Um perfil só com PIN abre direto no teclado. Contexto ganha `hasPin: boolean` e `setHasPin(v: boolean): void`.
  - "Esqueci o PIN" → `ForgotPin` → `DeleteProfileDialog` com `profiles = withFallback(file.profiles, ...)`, `close = async () => {}`, `onDeleted = next => lockToPicker(next.id)`
  - `Picker`: ícone `Lock` (`aria-label="com PIN"`) nos perfis com `hasPin`; recebe `locks`. `ProfileSwitcher`: `Lock` pequeno nos perfis com PIN; "Bloquear agora" se `hasPin || profiles.length >= 2`.

- [ ] **Step 1: Testes que falham**

```ts
// src/profiles/pin.test.ts
import { formatWait, pinKey, unlockMessage } from './pin'

test('teclado do PIN: só dígitos, até 4, apagar volta um', () => {
  expect(pinKey('', '1')).toBe('1')
  expect(pinKey('123', '4')).toBe('1234')
  expect(pinKey('1234', '5')).toBe('1234')
  expect(pinKey('12', 'a')).toBe('12')
  expect(pinKey('12', 'Backspace')).toBe('1')
  expect(pinKey('', 'Backspace')).toBe('')
})

test('contagem regressiva', () => {
  expect([0, 5, 47, 60, 299, 3600].map(formatWait)).toEqual(['0:00', '0:05', '0:47', '1:00', '4:59', '60:00'])
})

test('mensagem do PIN errado', () => {
  expect(unlockMessage({ kind: 'wrong', remaining: 3 })).toBe('PIN errado. Mais 3 tentativas antes da espera.')
  expect(unlockMessage({ kind: 'wrong', remaining: 1 })).toBe('PIN errado. Mais 1 tentativa antes da espera.')
  expect(unlockMessage({ kind: 'ok' })).toBeNull()
  expect(unlockMessage({ kind: 'locked', until: 1 })).toBeNull()
})
```

```ts
// src/profiles/profiles.test.ts
test('esquecer o PIN do único perfil deixa um perfil novo e vazio no lugar', () => {
  const [, novo] = withFallback([ana], NOW, () => 'novo1234')
  expect(novo).toEqual({ id: 'novo1234', name: 'Meu perfil', color: '#c6ff3d', avatar: null, dbFile: 'perfil-novo1234.db', createdAt: NOW })
  const dois = [legacyProfile('Gabriel', NOW), ana]
  expect(withFallback(dois, NOW, () => 'x')).toBe(dois)
})
```

- [ ] **Step 2: Rodar e ver falhar:** `pnpm vitest run src/profiles` → FAIL (`./pin` não existe, `withFallback` não exportado)

- [ ] **Step 3: Implementar** seguindo o mockup (aba 1, 2ª e 4ª telas).

- [ ] **Step 4: Rodar:** `pnpm test && pnpm build && cargo test --manifest-path src-tauri/Cargo.toml` → PASS

- [ ] **Step 5: Verificar no app** (ligue um PIN pelo devtools: `__TAURI__.core.invoke('profile_set_pin', { id, dbFile, pin: '1234' })` até a Task 6 existir):
  - Com 2+ perfis, o cadeado aparece no perfil com PIN; escolher abre o teclado; "Voltar" volta à escolha.
  - Um perfil só, com PIN: abre direto no teclado, sem "Voltar".
  - Teclado físico e clicável; PIN errado mostra a mensagem; 5 erros desligam o teclado com a contagem; feche o app e reabra: a espera continua.
  - "Bloquear agora" aparece com um perfil só se ele tem PIN, e volta ao teclado.
  - "Esqueci o PIN" → apagar com 2+ perfis vai para a escolha; com um perfil só, abre um "Meu perfil" vazio. Os arquivos, o item do cofre e a entrada do `pins.json` do perfil somem.

- [ ] **Step 6: Commit**

```bash
git add src/profiles src/pages/configuracoes/Perfil.tsx src/theme.css
git commit -m "feat(perfis): teclado do PIN, espera com contagem, cadeado e Esqueci o PIN"
```

---

### Task 6: Configurações › Perfil — ligar, trocar e tirar o PIN

**Files:**
- Create: `src/pages/configuracoes/PinConfig.tsx`
- Modify: `src/pages/configuracoes/Perfil.tsx` (renderiza `<PinConfig />` no card)

**Interfaces:**
- Consumes: `PinPad`, `unlockMessage`, `nowSecs` (Task 5), `useProfiles().hasPin/setHasPin`, `<BackupExport />` (Task 4), comandos `pin_supported`, `profile_set_pin`, `profile_change_pin`, `profile_remove_pin`
- Produces: `<PinConfig />`
  - `pin_supported` falso: texto **"PIN indisponível nesta instalação: o Yield não encontrou a criptografia do banco (SQLCipher)."** e nenhum botão.
  - Sem PIN: "Ligar PIN…" abre um painel com, nesta ordem: **"Se esquecer o PIN, os dados deste perfil não têm como voltar: nem o Yield consegue abrir. A única saída é restaurar um backup."**; **"4 dígitos protegem de quem usa este computador, não de quem copia o arquivo e testa as 10 mil combinações por fora."**; botão "Fazer backup agora" (abre `BackupExport` no painel); `PinPad` "Escolha um PIN de 4 dígitos" → "Repita o PIN"; diferentes → "Os PINs não são iguais. Comece de novo." e volta ao primeiro; iguais → `profile_set_pin` → `setHasPin(true)` e "PIN ligado.".
  - Com PIN: "Trocar PIN…" ("Digite o PIN atual" → novo duas vezes → `profile_change_pin`) e "Tirar PIN…" ("Digite o PIN atual" → `profile_remove_pin` → `setHasPin(false)`). `Wrong`/`Locked` do PIN atual aparecem no `PinPad` (`message`/`until`), sem avançar.
  - Durante o comando: painel ocupado ("Criptografando os dados…"); erro do Rust aparece no painel.

- [ ] **Step 1: Implementar** o componente.
- [ ] **Step 2: Rodar:** `pnpm test && pnpm build` → PASS
- [ ] **Step 3: Verificar no app**, num perfil de teste com dados inventados:
  - Ligar: `head -c 16 perfil-<id>.db` não é `SQLite format 3`; `sqlite3 perfil-<id>.db .tables` dá "file is not a database"; no Acesso às Chaves o item `yield.credentials.<id>` começa com `pin1:`; as `seguranca-perfil-<id>-*` sumiram; o app segue funcionando sem recarregar.
  - Fechar e abrir pede o PIN; os dados e a sincronização da Pluggy estão lá.
  - Trocar: o PIN antigo não abre mais, o novo abre. PIN atual errado conta no limite.
  - Tirar: `sqlite3` lê de novo; o item do cofre volta a ser JSON.
  - Exportar backup com PIN (começa com `YIELDBK2`) e importar no mesmo perfil.
- [ ] **Step 4: Commit**

```bash
git add src/pages/configuracoes/PinConfig.tsx src/pages/configuracoes/Perfil.tsx
git commit -m "feat(perfis): ligar, trocar e tirar PIN em Configurações › Perfil"
```

---

### Task 7: "Novo perfil" → "Restaurar de um backup"

**Files:**
- Create: `src/profiles/NewProfileModal.tsx`
- Modify: `src/profiles/active.ts` + `src/profiles/active.test.ts` (`createFromBackup`), `src/profiles/Picker.tsx` e `src/profiles/ProfileSwitcher.tsx` (usam o modal novo no lugar do `.modal` duplicado)

**Interfaces:**
- Consumes: `stageBackup` (Task 1), `swap_database` (Task 4), `newProfile`, `randomId`, `switchTo`, `ProfileForm`
- Produces:
  - `interface RestoreNewSteps { save(f: ProfilesFile): Promise<void>; activate(p: Profile): Promise<void>; swap(): Promise<unknown>; discard(): Promise<void> }`
  - `createFromBackup(profiles: Profile[], input: { name: string; color: string; avatar: string | null }, s: RestoreNewSteps, now: string, randomId: () => string): Promise<{ profile: Profile | null; error: string | null }>` — pré-condição: backup já aberto e validado por `stageBackup`. Ordem: `save` (lista com o perfil novo) → `activate` → `swap`. Falha no `save`: `{ profile: null, error: 'Não foi possível criar o perfil: <erro>' }`. Falha depois: `{ profile, error: 'O perfil foi criado, mas o backup não entrou: <erro>' }`. Qualquer falha chama `discard`.
  - `<NewProfileModal profiles onCancel(): void onCreated(p: Profile): void save(next: ProfilesFile): Promise<void> />` — `ProfileForm` "Criar perfil" e, embaixo, "Restaurar de um backup…": escolhe o arquivo (`.yield`/`.db`), pede a senha se `is_encrypted_backup`, `stageBackup`, depois o `ProfileForm` com "Criar e restaurar" → `createFromBackup` → `switchTo(p.id)`. Erro aparece no modal; com `profile` criado, o modal mostra o erro e "Entrar no perfil".

- [ ] **Step 1: Testes que falham** (`active.test.ts`, no estilo do `steps()` de `deleteActive`):

```ts
const input = { name: 'Restaurado', color: '#3a91dc', avatar: null }
const NOW = '2026-10-31T12:00:00.000Z'

test('restaurar como perfil novo: lista, ativa e troca o banco, nessa ordem', async () => {
  const calls: string[] = []
  const r = await createFromBackup([ana], input, {
    save: async f => { calls.push(`save:${f.profiles.map(p => p.id).join(',')}`) },
    activate: async p => { calls.push(`activate:${p.id}`) },
    swap: async () => { calls.push('swap') },
    discard: async () => { calls.push('discard') },
  }, NOW, () => 'novo1234')
  expect(calls).toEqual(['save:principal,novo1234', 'activate:novo1234', 'swap'])
  expect(r).toEqual({ profile: expect.objectContaining({ id: 'novo1234', dbFile: 'perfil-novo1234.db' }), error: null })
})

test('troca do banco falha: o perfil fica na lista e o restore.db é descartado', async () => {
  const calls: string[] = []
  const r = await createFromBackup([ana], input, {
    save: async () => { calls.push('save') }, activate: async () => { calls.push('activate') },
    swap: async () => { throw new Error('swap falhou') }, discard: async () => { calls.push('discard') },
  }, NOW, () => 'novo1234')
  expect(r.error).toBe('O perfil foi criado, mas o backup não entrou: swap falhou')
  expect(r.profile?.id).toBe('novo1234')
  expect(calls).toEqual(['save', 'activate', 'discard'])
})

test('lista não grava: nada é ativado nem trocado', async () => {
  const calls: string[] = []
  const r = await createFromBackup([ana], input, {
    save: async () => { throw new Error('disco cheio') }, activate: async () => { calls.push('activate') },
    swap: async () => { calls.push('swap') }, discard: async () => { calls.push('discard') },
  }, NOW, () => 'novo1234')
  expect(r).toEqual({ profile: null, error: 'Não foi possível criar o perfil: disco cheio' })
  expect(calls).toEqual(['discard'])
})
```

- [ ] **Step 2: Rodar e ver falhar:** `pnpm vitest run src/profiles/active.test.ts` → FAIL (`createFromBackup` não existe)
- [ ] **Step 3: Implementar** `createFromBackup` e o modal.
- [ ] **Step 4: Rodar:** `pnpm test && pnpm build && cargo test --manifest-path src-tauri/Cargo.toml` → PASS
- [ ] **Step 5: Verificar no app:** pela escolha de perfis e pela sidebar, restaurar um `.yield` v2 (de um perfil com PIN) e um v1 cria o perfil com os dados, sem PIN; senha errada fica no modal sem criar perfil; cancelar no meio não deixa `restore.db` na pasta.
- [ ] **Step 6: Commit**

```bash
git add src/profiles
git commit -m "feat(perfis): novo perfil a partir de um backup"
```

---

### Task 8: CI, avisos de licença e documentação

**Files:**
- Create: `src-tauri/licenses/SQLCipher-LICENSE.txt` (cópia de `libsqlite3-sys-0.30.1/sqlcipher/LICENSE`), `src-tauri/licenses/OpenSSL-LICENSE.txt` (o `LICENSE.txt` do OpenSSL do `openssl-src` resolvido no `Cargo.lock`)
- Modify: `src-tauri/tauri.conf.json` (`bundle.resources: ["licenses/*"]`), `.github/workflows/build.yml`, `.github/workflows/release.yml` (só comentário), `README.md`, `CHANGELOG.md`

- [ ] **Step 1: CI.** Em `build.yml` (Windows, shell padrão pwsh, para o OpenSSL achar o Strawberry Perl e não o do Git Bash), depois do passo "llama-server do Assistente" e antes do `tauri-action`: `- run: cargo test --manifest-path src-tauri/Cargo.toml`. Em `release.yml`, um comentário de uma linha acima do `tauri-action`: o macOS usa CommonCrypto e **não** pode ter `OPENSSL_DIR`. Rodar o workflow "Build Windows" à mão e conferir que `sqlcipher_esta_linkado` passou no log.
- [ ] **Step 2: README.** Na seção de Perfis: PIN opcional por perfil, o que ele protege, "esqueceu = perdeu, só um backup recupera", o limite de tentativas (1 min, 5 min, 15 min, 1 h; nunca apaga dados), a frase dos 4 dígitos, e que cópias antigas fora do app (Time Machine, backups do sistema) feitas antes do PIN continuam sem criptografia. Em "Privacidade e segurança": SQLCipher + Argon2id + AES-256-GCM no cofre. Nova seção "Licenças de terceiros": SQLCipher (BSD-3-Clause, Zetetic LLC) e OpenSSL 3 (Apache-2.0, só no Windows), apontando para `src-tauri/licenses/`.
- [ ] **Step 3: CHANGELOG** ("Não lançado" › Novidades): PIN por perfil com dados criptografados; limite de tentativas; "Esqueci o PIN"; restaurar backup como perfil novo; backup de perfil com PIN em formato novo (versões anteriores do app não abrem esse arquivo).
- [ ] **Step 4: Rodar tudo:** `pnpm test && pnpm build && cargo test --manifest-path src-tauri/Cargo.toml` → PASS; `pnpm tauri build` local e conferir que `licenses/` está dentro do `.app` (`Contents/Resources/licenses`).
- [ ] **Step 5: Commit**

```bash
git add src-tauri/licenses src-tauri/tauri.conf.json .github/workflows README.md CHANGELOG.md
git commit -m "docs: PIN no README e no CHANGELOG, licenças do SQLCipher e do OpenSSL, testes no CI do Windows"
```
