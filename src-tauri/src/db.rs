use serde_json::{Map, Value};
use sqlx::sqlite::{Sqlite, SqliteArguments, SqliteConnectOptions, SqlitePool, SqlitePoolOptions, SqliteValueRef};
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

fn err(e: impl ToString) -> String {
    e.to_string()
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
        Some(k) => format!("\"x'{}'\"", k.iter().map(|b| format!("{b:02x}")).collect::<String>()),
        None => "''".into(),
    }
}

async fn cipher_version_in<'e>(e: impl sqlx::SqliteExecutor<'e>) -> Option<String> {
    sqlx::query_scalar::<_, String>("PRAGMA cipher_version").fetch_optional(e).await.ok().flatten().filter(|v| !v.is_empty())
}

/// Versão do SQLCipher linkado; `None` num SQLite comum (lá a `PRAGMA key` é ignorada e o banco ficaria em claro).
#[cfg_attr(not(test), allow(dead_code))] // por ora só o teste confere; o desbloqueio com PIN passa a usar
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
    let pool = SqlitePoolOptions::new().connect_with(opts).await.map_err(err)?;
    // PIN errado só falha na primeira leitura: lê aqui, e não na primeira tela
    let checked = match sqlx::query("SELECT count(*) FROM sqlite_master").fetch_one(&pool).await {
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

// Bind e leitura copiados do tauri-plugin-sql 2.6.0 (Apache-2.0 OR MIT): os mesmos tipos que o app já recebia do plugin.
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

/// O nome vem do webview: só o banco do perfil aberto ou o backup em importação, sempre na pasta do app (como o plugin).
fn db_path(app: &tauri::AppHandle, file: &str) -> Result<PathBuf, String> {
    if file != crate::active()?.1 && file != crate::RESTORE_FILE {
        return Err("Banco fora do perfil aberto.".into());
    }
    let dir = app.path().app_config_dir().map_err(err)?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join(file))
}

async fn pool_of(dbs: &Dbs, file: &str) -> Result<SqlitePool, String> {
    dbs.0.lock().await.get(file).cloned().ok_or_else(|| "Banco não está aberto.".into())
}

#[tauri::command]
pub async fn db_load(app: tauri::AppHandle, state: State<'_, Dbs>, file: String) -> Result<(), String> {
    let path = db_path(&app, &file)?;
    if has_pin_file(&path)? {
        return Err("Perfil bloqueado: digite o PIN.".into());
    }
    let pool = open_pool(&path, None).await?;
    let old = state.0.lock().await.insert(file, pool);
    if let Some(old) = old {
        old.close().await;
    }
    Ok(())
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

/// Fecha os bancos abertos antes de trocar de perfil ou voltar à escolha de perfil.
#[tauri::command]
pub async fn profile_lock(state: State<'_, Dbs>) -> Result<(), String> {
    close_all(&state).await;
    Ok(())
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

    #[allow(dead_code)] // para os testes do PIN: nada do banco cifrado pode aparecer em claro no arquivo
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
}
