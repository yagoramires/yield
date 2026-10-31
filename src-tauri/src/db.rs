use serde_json::{Map, Value};
use sqlx::sqlite::{Sqlite, SqliteArguments, SqliteConnectOptions, SqliteOwnedBuf, SqlitePool, SqlitePoolOptions, SqliteValueRef};
use sqlx::query::Query;
use sqlx::{Column, Connection, Executor, Row, TypeInfo, Value as _, ValueRef};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{Manager, State};

pub type Key = [u8; 32];

/// Pools por nome de arquivo: o `db` do DataProvider só guarda o nome, então segue valendo depois de fechar e reabrir o mesmo arquivo.
#[derive(Default)]
pub struct Dbs(pub tokio::sync::Mutex<HashMap<String, SqlitePool>>);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub rows_affected: u64,
    pub last_insert_id: i64,
}

pub const CORRUPT: &str = "O arquivo do banco não é um banco do Yield ou está corrompido.";

fn err(e: impl ToString) -> String {
    e.to_string()
}

/// `SQLITE_NOTADB`: chave errada, ou o arquivo não é um banco.
fn is_notadb(e: &sqlx::Error) -> bool {
    matches!(e, sqlx::Error::Database(d) if d.code().as_deref() == Some("26"))
}

/// Banco cifrado pelo PIN: tem cabeçalho, mas não o do SQLite em claro.
pub fn has_pin_file(path: &Path) -> Result<bool, String> {
    match std::fs::metadata(path) {
        Ok(m) if m.len() >= 16 => Ok(!crate::starts_with(path, crate::SQLITE_MAGIC)?),
        Ok(_) => Ok(false),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(err(e)),
    }
}

/// Valor da chave para `PRAGMA key` e `ATTACH ... KEY`: chave "raw" (o SQLCipher não roda o PBKDF2 dele) ou nenhuma.
pub(crate) fn key_sql(key: Option<&Key>) -> String {
    match key {
        Some(k) => format!("\"x'{}'\"", crate::pin::hex(k)),
        None => "''".into(),
    }
}

async fn cipher_version_in<'e>(e: impl sqlx::SqliteExecutor<'e>) -> Option<String> {
    sqlx::query_scalar::<_, String>("PRAGMA cipher_version").fetch_optional(e).await.ok().flatten().filter(|v| !v.is_empty())
}

/// Versão do SQLCipher linkado; `None` num SQLite comum (lá a `PRAGMA key` é ignorada e o banco ficaria em claro).
pub async fn cipher_version() -> Option<String> {
    let mut conn = sqlx::SqliteConnection::connect("sqlite::memory:").await.ok()?;
    let v = cipher_version_in(&mut conn).await;
    let _ = conn.close().await;
    v
}

pub async fn open_pool(path: &Path, key: Option<&Key>) -> Result<SqlitePool, String> {
    let mut opts = SqliteConnectOptions::new().filename(path).create_if_missing(true).foreign_keys(true);
    if key.is_some() {
        // o sqlx manda a `key` antes de qualquer outra pragma, em toda conexão nova do pool
        opts = opts.pragma("key", key_sql(key));
    }
    let pool = SqlitePoolOptions::new().connect_with(opts).await.map_err(|e| if is_notadb(&e) { CORRUPT.into() } else { err(e) })?;
    // PIN errado só falha na primeira leitura: lê aqui, e não na primeira tela
    let checked = match sqlx::query("SELECT count(*) FROM sqlite_master").fetch_one(&pool).await {
        Err(e) if is_notadb(&e) => Err(CORRUPT.into()),
        Err(e) => Err(err(e)),
        Ok(_) if key.is_some() && cipher_version_in(&pool).await.is_none() => Err("Este Yield foi compilado sem criptografia de banco.".into()),
        Ok(_) => Ok(()),
    };
    if let Err(e) = checked {
        pool.close().await;
        return Err(e);
    }
    Ok(pool)
}

/// A chave abre o banco? Uma conexão só, sem criar o arquivo nem gravar nada nele.
pub async fn key_opens(path: &Path, key: &Key) -> Result<bool, String> {
    let opts = SqliteConnectOptions::new().filename(path).pragma("key", key_sql(Some(key)));
    let mut conn = match sqlx::SqliteConnection::connect_with(&opts).await {
        Ok(c) => c,
        Err(e) if is_notadb(&e) => return Ok(false),
        Err(e) => return Err(err(e)),
    };
    let read = sqlx::query("SELECT count(*) FROM sqlite_master").fetch_one(&mut conn).await;
    let cipher = cipher_version_in(&mut conn).await;
    let _ = conn.close().await;
    match read {
        Err(e) if is_notadb(&e) => Ok(false),
        Err(e) => Err(err(e)),
        // num SQLite comum a chave é ignorada e qualquer PIN "abriria" um banco em claro
        Ok(_) if cipher.is_none() => Err("Este Yield foi compilado sem criptografia de banco.".into()),
        Ok(_) => Ok(true),
    }
}

// Bind e leitura copiados do tauri-plugin-sql 2.6.0 (Apache-2.0 OR MIT): os mesmos tipos que o app já recebia do plugin.
// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
fn bind_all(sql: &str, params: Vec<Value>) -> Query<'_, Sqlite, SqliteArguments<'_>> {
    let mut query = sqlx::query(sql);
    for value in params {
        if value.is_null() {
            query = query.bind(None::<Value>);
        } else if value.is_string() {
            query = query.bind(value.as_str().unwrap().to_owned())
        } else if let Some(number) = value.as_number() {
            query = query.bind(number.as_f64().unwrap_or_default())
        } else {
            query = query.bind(value);
        }
    }
    query
}

// Copiado do tauri-plugin-sql 2.6.0 (Apache-2.0 OR MIT), `decode/sqlite.rs`.
// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
fn to_json(v: SqliteValueRef) -> Result<Value, String> {
    use sqlx::types::time::{Date, PrimitiveDateTime, Time};
    if v.is_null() {
        return Ok(Value::Null);
    }
    let res = match v.type_info().name() {
        "TEXT" => v.to_owned().try_decode().map(Value::String).unwrap_or(Value::Null),
        "REAL" => v.to_owned().try_decode::<f64>().map(Value::from).unwrap_or(Value::Null),
        "INTEGER" | "NUMERIC" => v.to_owned().try_decode::<i64>().map(|n| Value::Number(n.into())).unwrap_or(Value::Null),
        "BOOLEAN" => v.to_owned().try_decode().map(Value::Bool).unwrap_or(Value::Null),
        "DATE" => v.to_owned().try_decode::<Date>().map(|d| Value::String(d.to_string())).unwrap_or(Value::Null),
        "TIME" => v.to_owned().try_decode::<Time>().map(|t| Value::String(t.to_string())).unwrap_or(Value::Null),
        "DATETIME" => v.to_owned().try_decode::<PrimitiveDateTime>().map(|d| Value::String(d.to_string())).unwrap_or(Value::Null),
        "BLOB" => v
            .to_owned()
            .try_decode::<Vec<u8>>()
            .map(|b| Value::Array(b.into_iter().map(|n| Value::Number(n.into())).collect()))
            .unwrap_or(Value::Null),
        "NULL" => Value::Null,
        other => return Err(format!("unsupported datatype: {other}")),
    };
    Ok(res)
}

pub async fn select(pool: &SqlitePool, sql: &str, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    let rows = pool.fetch_all(bind_all(sql, params)).await.map_err(err)?;
    rows.iter()
        .map(|row| row.columns().iter().enumerate().map(|(i, c)| Ok((c.name().to_string(), to_json(row.try_get_raw(i).map_err(err)?)?))).collect())
        .collect()
}

/// Roda todos os comandos do texto, como o plugin (as migrações mandam `BEGIN; ... COMMIT;` num `execute` só).
pub async fn execute(pool: &SqlitePool, sql: &str, params: Vec<Value>) -> Result<ExecResult, String> {
    let r = pool.execute(bind_all(sql, params)).await.map_err(err)?;
    Ok(ExecResult { rows_affected: r.rows_affected(), last_insert_id: r.last_insert_rowid() })
}

pub async fn close_all(dbs: &Dbs) {
    let pools: Vec<SqlitePool> = dbs.0.lock().await.drain().map(|(_, p)| p).collect();
    for p in pools {
        p.close().await;
    }
}

/// Fecha os bancos que não são `keep`: na troca de perfil, nenhum pool sobrevive ao bloqueio do perfil dono dele.
pub async fn close_others(dbs: &Dbs, keep: &str) {
    let pools: Vec<SqlitePool> = {
        let mut map = dbs.0.lock().await;
        let others: Vec<String> = map.keys().filter(|f| *f != keep).cloned().collect();
        others.iter().filter_map(|f| map.remove(f)).collect()
    };
    for p in pools {
        p.close().await;
    }
}

/// O nome vem do webview: só o banco do perfil aberto ou o backup em importação, sempre na pasta do app (como o plugin).
fn db_dir(app: &tauri::AppHandle, file: &str) -> Result<PathBuf, String> {
    open_allowed(file)?;
    let dir = app.path().app_config_dir().map_err(err)?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

fn open_allowed(file: &str) -> Result<(), String> {
    if file != crate::active()?.1 && file != crate::RESTORE_FILE {
        return Err("Banco fora do perfil aberto.".into());
    }
    Ok(())
}

/// Pool de `file`, só do perfil aberto ou do backup em importação: um pool que sobrou de outro perfil não responde.
pub(crate) async fn pool_of(dbs: &Dbs, file: &str) -> Result<SqlitePool, String> {
    open_allowed(file)?;
    dbs.0.lock().await.get(file).cloned().ok_or_else(|| "Banco não está aberto.".into())
}

#[tauri::command]
pub async fn db_load(app: tauri::AppHandle, state: State<'_, Dbs>, file: String) -> Result<(), String> {
    load_in(&state, &db_dir(&app, &file)?, &file).await
}

/// Abre `dir/file` com a chave do `pin::key_for`; já aberto, não reabre.
pub async fn load_in(dbs: &Dbs, dir: &Path, file: &str) -> Result<(), String> {
    // a trava durante a abertura toda: a troca do PIN (que também a segura) não acontece no meio
    let mut map = dbs.0.lock().await;
    // a chave antes do atalho: um pool que ficou aberto não dispensa o PIN
    let key = crate::pin::key_for(dir, file)?;
    // o StrictMode do React carrega duas vezes: o segundo não fecha o pool que o primeiro já entregou
    if map.contains_key(file) {
        return Ok(());
    }
    let pool = open_pool(&dir.join(file), key.as_ref()).await?;
    // o perfil pode ter mudado enquanto abria: o pool de um perfil que não está mais aberto não fica
    if open_allowed(file).is_err() {
        pool.close().await;
        return Err(crate::pin::LOCKED.into());
    }
    map.insert(file.into(), pool);
    Ok(())
}

/// `<db_file>.pin-tmp`: o banco recriado com a chave nova, antes de tomar o lugar do original.
pub fn pin_tmp(dir: &Path, db_file: &str) -> PathBuf {
    dir.join(format!("{db_file}.pin-tmp"))
}

const PIN_TMP_SUFFIXES: [&str; 4] = [".pin-tmp", ".pin-tmp-journal", ".pin-tmp-wal", ".pin-tmp-shm"];

pub(crate) fn remove_tmp(to: &Path) -> Result<(), String> {
    for ext in ["", "-journal", "-wal", "-shm"] {
        let mut p = to.as_os_str().to_owned();
        p.push(ext);
        crate::remove_if_exists(Path::new(&p))?;
    }
    Ok(())
}

/// Com chave, o arquivo novo não pode ter o cabeçalho em claro: um SQLite sem criptografia ignora a `KEY`.
fn refuse_plain(path: &Path, key: Option<&Key>) -> Result<(), String> {
    if key.is_some() && crate::starts_with(path, crate::SQLITE_MAGIC)? {
        return Err("A criptografia do banco não está ativa nesta instalação; nada foi alterado.".into());
    }
    Ok(())
}

/// Copia `from` para `to` (novo) com outra chave e confere a cópia; em qualquer erro `to` some.
pub async fn export_verified(from: &Path, from_key: Option<&Key>, to: &Path, to_key: Option<&Key>) -> Result<(), String> {
    let r = export_into(from, from_key, to, to_key).await;
    if r.is_err() {
        let _ = remove_tmp(to);
    }
    r
}

async fn export_into(from: &Path, from_key: Option<&Key>, to: &Path, to_key: Option<&Key>) -> Result<(), String> {
    remove_tmp(to)?;
    // a conexão em `from` não tem permissão de criar arquivo (não cria um banco que sumiu): o ATTACH abre um vazio
    std::fs::File::create(to).map_err(err)?;
    let mut opts = SqliteConnectOptions::new().filename(from);
    if from_key.is_some() {
        opts = opts.pragma("key", key_sql(from_key));
    }
    let mut conn = sqlx::SqliteConnection::connect_with(&opts).await.map_err(err)?;
    let copied = async {
        // a primeira leitura desfaz um `-journal` quente: a cópia sai do banco consistente
        sqlx::query("SELECT count(*) FROM sqlite_master").execute(&mut conn).await?;
        sqlx::query(&format!("ATTACH DATABASE ? AS dst KEY {}", key_sql(to_key))).bind(to.to_string_lossy().into_owned()).execute(&mut conn).await?;
        sqlx::query("SELECT sqlcipher_export('dst')").execute(&mut conn).await?;
        sqlx::query("DETACH DATABASE dst").execute(&mut conn).await
    }
    .await;
    let _ = conn.close().await;
    copied.map_err(err)?;
    refuse_plain(to, to_key)?;
    let mut opts = SqliteConnectOptions::new().filename(to);
    if to_key.is_some() {
        opts = opts.pragma("key", key_sql(to_key));
    }
    let mut conn = sqlx::SqliteConnection::connect_with(&opts).await.map_err(err)?;
    let check = sqlx::query_scalar::<_, String>("PRAGMA integrity_check").fetch_one(&mut conn).await;
    let _ = conn.close().await;
    if check.map_err(err)? != "ok" {
        return Err(CORRUPT.into());
    }
    // no Windows o FlushFileBuffers precisa do arquivo aberto para escrita
    std::fs::OpenOptions::new().write(true).open(to).and_then(|f| f.sync_all()).map_err(err)
}

/// Grava em `to` (novo) o banco em claro `bytes`, cifrado com `to_key`: o texto claro só existe na memória.
pub async fn stage_plain(mut bytes: Vec<u8>, to: &Path, to_key: &Key) -> Result<(), String> {
    // banco em WAL (versões antigas): o deserialize recusa; o arquivo inteiro já está aqui, sem `-wal`
    if bytes.len() > 19 && bytes.starts_with(crate::SQLITE_MAGIC) && bytes[18] == 2 {
        (bytes[18], bytes[19]) = (1, 1);
    }
    remove_tmp(to)?;
    // a conexão em memória não cria arquivo: o ATTACH abre um vazio
    std::fs::File::create(to).map_err(err)?;
    let r = async {
        // ":memory:" direto: o "sqlite::memory:" do sqlx usa cache compartilhado, e lá o deserialize não vale
        let mut conn = sqlx::SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(":memory:")).await?;
        let copied = async {
            conn.deserialize(None, SqliteOwnedBuf::try_from(&bytes[..])?, false).await?;
            sqlx::query(&format!("ATTACH DATABASE ? AS dst KEY {}", key_sql(Some(to_key)))).bind(to.to_string_lossy().into_owned()).execute(&mut conn).await?;
            sqlx::query("SELECT sqlcipher_export('dst')").execute(&mut conn).await?;
            sqlx::query("DETACH DATABASE dst").execute(&mut conn).await
        }
        .await;
        let _ = conn.close().await;
        copied
    }
    .await;
    if r.is_err() {
        let _ = remove_tmp(to);
    }
    r.map(|_| ()).map_err(err)
}

/// Põe `tmp` no lugar de `<dir>/<db_file>`: o rename é atômico, então um crash deixa o banco velho ou o novo, inteiro.
pub fn commit_swap(dir: &Path, db_file: &str, tmp: &Path) -> Result<(), String> {
    for ext in ["-journal", "-wal"] {
        if dir.join(format!("{db_file}{ext}")).exists() {
            // seria aplicado sobre o arquivo novo, que é outro banco
            return Err("O banco ainda tem transações pendentes; feche e abra o Yield e tente de novo.".into());
        }
    }
    std::fs::rename(tmp, dir.join(db_file)).map_err(err)?;
    // depois do rename a troca já valeu: `Err` aqui faria quem chama achar que o banco ainda tem a chave antiga
    #[cfg(unix)]
    let _ = std::fs::File::open(dir).and_then(|d| d.sync_all());
    Ok(())
}

/// No startup: um `.pin-tmp` é uma troca de PIN que não chegou ao rename; o banco original segue valendo.
pub fn cleanup_pin_tmp(dir: &Path) {
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if PIN_TMP_SUFFIXES.iter().any(|s| name.ends_with(s)) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[tauri::command]
pub async fn db_select(state: State<'_, Dbs>, file: String, sql: String, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    select(&pool_of(&state, &file).await?, &sql, params).await
}

#[tauri::command]
pub async fn db_execute(state: State<'_, Dbs>, file: String, sql: String, params: Vec<Value>) -> Result<ExecResult, String> {
    execute(&pool_of(&state, &file).await?, &sql, params).await
}

#[tauri::command]
pub async fn db_close(state: State<'_, Dbs>, file: String) -> Result<(), String> {
    let pool = state.0.lock().await.remove(&file);
    if let Some(pool) = pool {
        pool.close().await;
    }
    Ok(())
}

/// Fecha os bancos abertos e esquece as chaves antes de trocar de perfil ou voltar à escolha de perfil.
#[tauri::command]
pub async fn profile_lock(state: State<'_, Dbs>) -> Result<(), String> {
    lock_in(&state).await;
    Ok(())
}

pub async fn lock_in(dbs: &Dbs) {
    // espera a troca de PIN em andamento: terminando depois, ela deixaria as chaves no UNLOCKED
    let _op = crate::pin::PIN_OPS.lock().await;
    close_all(dbs).await;
    // trava envenenada não impede de esquecer as chaves
    *crate::pin::UNLOCKED.lock().unwrap_or_else(|e| e.into_inner()) = None;
    *crate::pin::RESTORE.lock().unwrap_or_else(|e| e.into_inner()) = None;
    *crate::VAULT.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

#[cfg(test)]
pub(crate) mod testutil {
    use std::path::{Path, PathBuf};

    pub const MARKER: &str = "SEGREDO_PLAINTEXT_MARKER_42";

    /// Pasta vazia só deste teste; canonicalizada porque no macOS o temp_dir passa por um link (/var → /private/var).
    pub fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("yield-db-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    /// Nada do banco cifrado pode aparecer em claro no arquivo.
    pub fn file_has(path: &Path, needle: &str) -> bool {
        std::fs::read(path).unwrap().windows(needle.len()).any(|w| w == needle.as_bytes())
    }

    pub fn is_plain_header(path: &Path) -> bool {
        std::fs::read(path).unwrap().starts_with(b"SQLite format 3\0")
    }
}

#[cfg(test)]
mod tests {
    use super::testutil::*;
    use super::*;
    use serde_json::json;

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

    #[tokio::test]
    async fn tem_pin_pelo_cabecalho_do_arquivo() {
        let dir = tmp("has-pin");
        assert!(!has_pin_file(&dir.join("ausente.db")).unwrap());
        std::fs::write(dir.join("curto.db"), b"SQLite").unwrap();
        assert!(!has_pin_file(&dir.join("curto.db")).unwrap());
        let pool = open_pool(&dir.join("claro.db"), None).await.unwrap();
        execute(&pool, "CREATE TABLE t (v TEXT)", vec![]).await.unwrap();
        pool.close().await;
        assert!(is_plain_header(&dir.join("claro.db")) && !has_pin_file(&dir.join("claro.db")).unwrap());
        let key = [7u8; 32];
        let pool = open_pool(&dir.join("cifrado.db"), Some(&key)).await.unwrap();
        execute(&pool, "CREATE TABLE t (v TEXT)", vec![]).await.unwrap();
        pool.close().await;
        assert!(has_pin_file(&dir.join("cifrado.db")).unwrap());
    }

    #[tokio::test]
    async fn chave_abre_ou_nao_o_banco() {
        let dir = tmp("key-opens");
        let (key, other) = ([7u8; 32], [8u8; 32]);
        let pool = open_pool(&dir.join("c.db"), Some(&key)).await.unwrap();
        execute(&pool, "CREATE TABLE t (v TEXT)", vec![]).await.unwrap();
        pool.close().await;
        assert!(key_opens(&dir.join("c.db"), &key).await.unwrap());
        assert!(!key_opens(&dir.join("c.db"), &other).await.unwrap());
        assert!(key_opens(&dir.join("ausente.db"), &key).await.is_err());
        assert!(!dir.join("ausente.db").exists());
        assert_eq!(open_pool(&dir.join("c.db"), Some(&other)).await.unwrap_err(), CORRUPT);
        std::fs::write(dir.join("lixo.db"), [0xAB; 4096]).unwrap();
        assert_eq!(open_pool(&dir.join("lixo.db"), None).await.unwrap_err(), CORRUPT);
    }

    #[tokio::test]
    async fn com_chave_recusa_copia_em_claro() {
        let dir = tmp("refuse-plain");
        let pool = open_pool(&dir.join("claro.db"), None).await.unwrap();
        execute(&pool, "CREATE TABLE t (v TEXT)", vec![]).await.unwrap();
        pool.close().await;
        assert_eq!(refuse_plain(&dir.join("claro.db"), Some(&[7u8; 32])).unwrap_err(), "A criptografia do banco não está ativa nesta instalação; nada foi alterado.");
        assert!(refuse_plain(&dir.join("claro.db"), None).is_ok());
        std::fs::write(dir.join("cifrado.db"), [0xAB; 64]).unwrap();
        assert!(refuse_plain(&dir.join("cifrado.db"), Some(&[7u8; 32])).is_ok());
    }

    #[tokio::test]
    async fn bloquear_espera_a_troca_do_pin() {
        let _g = crate::pin::testutil::globals();
        let troca = crate::pin::PIN_OPS.lock().await;
        let dbs = Dbs::default();
        let mut lock = Box::pin(lock_in(&dbs));
        assert!(tokio::time::timeout(std::time::Duration::from_millis(50), &mut lock).await.is_err());
        // a troca termina deixando as chaves do PIN novo: o bloqueio que esperava as apaga
        *crate::pin::UNLOCKED.lock().unwrap() = Some(("abcd1234".into(), crate::pin::derive("1234", &crate::pin::testutil::SALT).unwrap()));
        drop(troca);
        lock.await;
        assert!(crate::pin::UNLOCKED.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn backup_em_wal_vira_banco_cifrado_sem_passar_pelo_disco() {
        let dir = tmp("stage-wal");
        let pool = open_pool(&dir.join("wal.db"), None).await.unwrap();
        execute(&pool, "PRAGMA journal_mode = WAL", vec![]).await.unwrap();
        execute(&pool, "CREATE TABLE t (v TEXT)", vec![]).await.unwrap();
        execute(&pool, "INSERT INTO t (v) VALUES (?)", vec![json!(MARKER)]).await.unwrap();
        execute(&pool, "PRAGMA wal_checkpoint(TRUNCATE)", vec![]).await.unwrap(); // como o VACUUM INTO: tudo no arquivo
        pool.close().await;
        let bytes = std::fs::read(dir.join("wal.db")).unwrap();
        assert_eq!((bytes[18], bytes[19]), (2, 2)); // o deserialize recusa banco em WAL
        let key = [9u8; 32];
        stage_plain(bytes, &dir.join("r.db"), &key).await.unwrap();
        assert!(!is_plain_header(&dir.join("r.db")) && !file_has(&dir.join("r.db"), MARKER));
        let pool = open_pool(&dir.join("r.db"), Some(&key)).await.unwrap();
        assert_eq!(select(&pool, "SELECT v FROM t", vec![]).await.unwrap()[0]["v"], MARKER);
        assert!(stage_plain(b"nao e banco".to_vec(), &dir.join("x.db"), &key).await.is_err() && !dir.join("x.db").exists());
    }

    #[tokio::test]
    async fn pool_so_do_perfil_aberto() {
        let _g = crate::pin::testutil::globals();
        let dir = crate::pin::testutil::em_claro("perfil-abcd1234.db").await;
        let dbs = Dbs::default();
        *crate::ACTIVE.lock().unwrap() = Some(("abcd1234".into(), "perfil-abcd1234.db".into()));
        load_in(&dbs, &dir, "perfil-abcd1234.db").await.unwrap();
        assert!(pool_of(&dbs, "perfil-abcd1234.db").await.is_ok());
        // outro perfil ativado (sem o close_others ainda): o pool que sobrou não responde
        *crate::ACTIVE.lock().unwrap() = Some(("zzzz9999".into(), "perfil-zzzz9999.db".into()));
        assert_eq!(pool_of(&dbs, "perfil-abcd1234.db").await.unwrap_err(), "Banco fora do perfil aberto.");
        // abrir o banco de um perfil que deixou de ser o ativo: o pool novo não entra
        dbs.0.lock().await.clear();
        assert_eq!(load_in(&dbs, &dir, "perfil-abcd1234.db").await.unwrap_err(), "Perfil bloqueado: digite o PIN.");
        assert!(dbs.0.lock().await.is_empty());
        *crate::ACTIVE.lock().unwrap() = None;
    }
}
