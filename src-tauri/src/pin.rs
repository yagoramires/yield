use crate::db::{cipher_version, has_pin_file, key_opens, Key, CORRUPT};
use crate::{active, valid_profile, write_atomic, LEGACY_DB, LEGACY_ID, RESTORE_FILE};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// Argon2id(PIN, sal) → 64 bytes: os 32 primeiros abrem o banco, os outros 32 o item do cofre.
#[derive(Clone)]
pub struct Keys {
    pub db: Key,
    pub vault: Key,
}

pub const PINS_FILE: &str = "pins.json";
const PER_ROUND: u32 = 5;
const WAITS: [u64; 4] = [60, 300, 900, 3600];
const LOCKED: &str = "Perfil bloqueado: digite o PIN.";

/// Sal e tentativas de cada perfil com PIN; fica na pasta de config e só o Rust lê e grava.
#[derive(Serialize, Deserialize, Default)]
pub struct PinsFile {
    pub version: u32,
    pub profiles: BTreeMap<String, PinState>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
pub struct PinState {
    pub salt: String, // 32 hex
    pub fails: u32,
    pub until: u64, // unix s; 0 = sem espera
}

#[derive(Serialize, PartialEq, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Unlock {
    Ok,
    Wrong { remaining: u32 },
    Locked { until: u64 },
}

// Chaves do perfil desbloqueado (id, chaves) e do `restore.db` cifrado; nunca vão para o webview.
pub(crate) static UNLOCKED: Mutex<Option<(String, Keys)>> = Mutex::new(None);
pub(crate) static RESTORE: Mutex<Option<Key>> = Mutex::new(None);
// tentativas em paralelo contam uma a uma: ler, conferir e gravar o pins.json é uma coisa só
static CHECKING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
// toda gravação do pins.json, e a reconstrução do ilegível, uma de cada vez (sem await dentro)
static PINS_WRITE: Mutex<()> = Mutex::new(());

fn err(e: impl ToString) -> String {
    e.to_string()
}

fn now() -> Result<u64, String> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_secs())
}

pub fn valid_pin(pin: &str) -> bool {
    pin.len() == 4 && pin.bytes().all(|b| b.is_ascii_digit())
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|b| format!("{b:02x}")).collect()
}

fn salt_from_hex(s: &str) -> Option<[u8; 16]> {
    if s.len() != 32 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let mut out = [0u8; 16];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(out)
}

pub fn derive(pin: &str, salt: &[u8; 16]) -> Result<Keys, String> {
    use argon2::{Algorithm, Argon2, Params, Version};
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, Params::new(65536, 3, 1, Some(64)).map_err(err)?);
    let mut out = [0u8; 64];
    argon.hash_password_into(pin.as_bytes(), salt, &mut out).map_err(err)?;
    let (mut db, mut vault) = ([0u8; 32], [0u8; 32]);
    db.copy_from_slice(&out[..32]);
    vault.copy_from_slice(&out[32..]);
    Ok(Keys { db, vault })
}

/// Id do perfil dono de `db_file` (o par tem de ser válido).
fn id_of(db_file: &str) -> Option<&str> {
    let id = if db_file == LEGACY_DB { LEGACY_ID } else { db_file.strip_prefix("perfil-")?.strip_suffix(".db")? };
    valid_profile(id, db_file).then_some(id)
}

/// Cópia do sal ao lado do banco: perder o `pins.json` não pode trancar o perfil (o sal não é segredo).
pub fn salt_copy(dir: &Path, db_file: &str) -> PathBuf {
    dir.join(format!("{db_file}.salt"))
}

pub fn write_salt_copy(dir: &Path, db_file: &str, salt: &[u8; 16]) -> Result<(), String> {
    write_atomic(&salt_copy(dir, db_file), &hex(salt))
}

pub fn read_salt_copy(dir: &Path, db_file: &str) -> Option<[u8; 16]> {
    salt_from_hex(std::fs::read_to_string(salt_copy(dir, db_file)).ok()?.trim())
}

/// Ausente → vazio. Ilegível → guarda uma cópia e refaz as entradas pelas cópias `<db>.salt` (sem a contagem de erros).
pub fn read_pins(dir: &Path) -> Result<PinsFile, String> {
    if let Some(f) = parse_pins(dir)? {
        return Ok(f);
    }
    let _w = PINS_WRITE.lock().unwrap_or_else(|e| e.into_inner());
    // outra chamada pode ter refeito (ou gravado uma contagem nova) enquanto esta esperava
    if let Some(f) = parse_pins(dir)? {
        return Ok(f);
    }
    // a cópia antes de tudo: o pins.json refeito vai por cima do ilegível
    std::fs::copy(dir.join(PINS_FILE), dir.join(format!("{PINS_FILE}.ilegivel-{}", now()?))).map_err(err)?;
    let mut f = empty_pins();
    for entry in std::fs::read_dir(dir).map_err(err)?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(db_file) = name.strip_suffix(".salt") else { continue };
        if let (Some(id), Some(salt)) = (id_of(db_file), read_salt_copy(dir, db_file)) {
            f.profiles.insert(id.into(), PinState { salt: hex(&salt), fails: 0, until: 0 });
        }
    }
    save_pins(dir, &f)?;
    Ok(f)
}

fn empty_pins() -> PinsFile {
    PinsFile { version: 1, profiles: BTreeMap::new() }
}

/// `None` = ilegível (JSON ruim ou não é UTF-8); ausente vale como vazio.
fn parse_pins(dir: &Path) -> Result<Option<PinsFile>, String> {
    match std::fs::read_to_string(dir.join(PINS_FILE)) {
        Ok(s) => Ok(serde_json::from_str(&s).ok()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Some(empty_pins())),
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => Ok(None),
        Err(e) => Err(err(e)),
    }
}

pub fn write_pins(dir: &Path, f: &PinsFile) -> Result<(), String> {
    let _w = PINS_WRITE.lock().unwrap_or_else(|e| e.into_inner());
    save_pins(dir, f)
}

fn save_pins(dir: &Path, f: &PinsFile) -> Result<(), String> {
    write_atomic(&dir.join(PINS_FILE), &serde_json::to_string_pretty(f).map_err(err)?)
}

pub fn locked_until(s: &PinState, now: u64) -> Option<u64> {
    (s.until > now).then_some(s.until)
}

pub fn register_failure(s: &mut PinState, now: u64) -> Unlock {
    s.fails += 1;
    if s.fails % PER_ROUND == 0 {
        s.until = now + WAITS[(s.fails / PER_ROUND - 1).min(3) as usize];
        Unlock::Locked { until: s.until }
    } else {
        Unlock::Wrong { remaining: PER_ROUND - s.fails % PER_ROUND }
    }
}

/// Confere o PIN de `id` no banco `dir/db_file`; o limite de tentativas vale aqui e fica gravado no `pins.json`.
pub async fn check_pin_in(dir: &Path, id: &str, db_file: &str, pin: &str, now: u64) -> Result<(Unlock, Option<Keys>), String> {
    if !valid_profile(id, db_file) {
        return Err("Perfil inválido.".into());
    }
    if !valid_pin(pin) {
        return Err("O PIN tem 4 dígitos.".into());
    }
    let _checking = CHECKING.lock().await;
    let mut pins = read_pins(dir)?;
    let entry = pins.profiles.get(id).cloned();
    let salt = match entry.as_ref().and_then(|s| salt_from_hex(&s.salt)) {
        Some(salt) => salt,
        None => read_salt_copy(dir, db_file).ok_or("Não encontrei o sal do PIN deste perfil em pins.json; sem ele o banco não abre.")?,
    };
    // entrada com sal estragado mantém a contagem de erros: só o sal vem da cópia
    let mut state = entry.unwrap_or(PinState { salt: String::new(), fails: 0, until: 0 });
    state.salt = hex(&salt);
    if let Some(until) = locked_until(&state, now) {
        return Ok((Unlock::Locked { until }, None));
    }
    let pin = pin.to_owned();
    let keys = tauri::async_runtime::spawn_blocking(move || derive(&pin, &salt)).await.map_err(err)??;
    let (result, keys) = if key_opens(&dir.join(db_file), &keys.db).await? {
        state.fails = 0;
        state.until = 0;
        if read_salt_copy(dir, db_file).is_none() {
            write_salt_copy(dir, db_file, &salt)?;
        }
        (Unlock::Ok, Some(keys))
    } else {
        (register_failure(&mut state, now), None)
    };
    pins.profiles.insert(id.into(), state);
    write_pins(dir, &pins)?;
    Ok((result, keys))
}

/// Chave para abrir `file`: `None` em claro; `restore.db` usa a do backup aberto; o banco do perfil ativo, a do desbloqueio.
pub fn key_for(dir: &Path, file: &str) -> Result<Option<Key>, String> {
    if !has_pin_file(&dir.join(file))? {
        return Ok(None);
    }
    if file == RESTORE_FILE {
        return Ok(*RESTORE.lock().map_err(err)?);
    }
    let (id, active_file) = active()?;
    if file == active_file {
        if let Some((u, keys)) = UNLOCKED.lock().map_err(err)?.as_ref() {
            if *u == id {
                return Ok(Some(keys.db));
            }
        }
    }
    // sem sal em lugar nenhum não é um banco com PIN: é outra coisa ou está corrompido
    let has_salt = read_salt_copy(dir, file).is_some() || read_pins(dir)?.profiles.contains_key(&id);
    Err(if has_salt { LOCKED } else { CORRUPT }.into())
}

#[cfg_attr(not(test), allow(dead_code))] // o cofre cifrado pelo PIN (Task 3) usa
pub fn vault_key_for(id: &str) -> Option<Key> {
    UNLOCKED.lock().ok()?.as_ref().filter(|(u, _)| u == id).map(|(_, k)| k.vault)
}

static SUPPORTED: tokio::sync::OnceCell<bool> = tokio::sync::OnceCell::const_new();

/// PIN só com o SQLCipher linkado: num SQLite comum a `PRAGMA key` é ignorada e o banco ficaria em claro.
#[tauri::command]
pub async fn pin_supported() -> bool {
    *SUPPORTED.get_or_init(|| async { cipher_version().await.is_some() }).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRef {
    id: String,
    db_file: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinInfo {
    has_pin: bool,
    until: Option<u64>,
}

/// Para a tela de escolha: quem tem PIN (pelo cabeçalho do banco) e até quando espera; par inválido fica de fora.
#[tauri::command]
pub fn profiles_locks(app: tauri::AppHandle, profiles: Vec<ProfileRef>) -> Result<HashMap<String, PinInfo>, String> {
    let dir = app.path().app_config_dir().map_err(err)?;
    let pins = read_pins(&dir)?;
    let now = now()?;
    let mut out = HashMap::new();
    for p in profiles.into_iter().filter(|p| valid_profile(&p.id, &p.db_file)) {
        // um arquivo ilegível não derruba a lista: o db_load dele é que vai dizer o erro
        let Ok(has_pin) = has_pin_file(&dir.join(&p.db_file)) else { continue };
        let until = pins.profiles.get(&p.id).and_then(|s| locked_until(s, now));
        out.insert(p.id, PinInfo { has_pin, until });
    }
    Ok(out)
}

#[tauri::command]
pub fn profile_unlocked(id: String) -> Result<bool, String> {
    Ok(UNLOCKED.lock().map_err(err)?.as_ref().is_some_and(|(u, _)| *u == id))
}

#[tauri::command]
pub async fn profile_unlock(app: tauri::AppHandle, id: String, db_file: String, pin: String) -> Result<Unlock, String> {
    let dir = app.path().app_config_dir().map_err(err)?;
    let (result, keys) = check_pin_in(&dir, &id, &db_file, &pin, now()?).await?;
    if let Some(keys) = keys {
        *UNLOCKED.lock().map_err(err)? = Some((id, keys));
    }
    Ok(result)
}

#[cfg(test)]
pub(crate) mod testutil {
    use super::*;
    use crate::db::testutil::{tmp, MARKER};
    use crate::db::{execute, open_pool, Key};
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    pub const SALT: [u8; 16] = *b"sal-de-teste-16b";

    // testes que mexem no perfil ativo ou no UNLOCKED (estado global) rodam um de cada vez
    static GLOBALS: std::sync::Mutex<()> = std::sync::Mutex::new(());
    pub fn globals() -> std::sync::MutexGuard<'static, ()> {
        GLOBALS.lock().unwrap_or_else(|e| e.into_inner())
    }

    // os testes rodam em paralelo no mesmo processo: cada banco ganha a sua pasta
    static N: AtomicU32 = AtomicU32::new(0);

    async fn banco(db_file: &str, key: Option<&Key>) -> PathBuf {
        let dir = tmp(&format!("pin-{}", N.fetch_add(1, Ordering::Relaxed)));
        let pool = open_pool(&dir.join(db_file), key).await.unwrap();
        execute(&pool, "CREATE TABLE t (v TEXT)", vec![]).await.unwrap();
        execute(&pool, "INSERT INTO t (v) VALUES (?)", vec![json!(MARKER)]).await.unwrap();
        pool.close().await;
        dir
    }

    pub async fn em_claro(db_file: &str) -> PathBuf {
        banco(db_file, None).await
    }

    /// Banco cifrado com o PIN, a entrada no `pins.json` e a cópia `<db_file>.salt`, as duas com `SALT`.
    pub async fn cifrado(db_file: &str, pin: &str) -> PathBuf {
        let dir = banco(db_file, Some(&derive(pin, &SALT).unwrap().db)).await;
        let id = id_of(db_file).unwrap();
        let mut f = read_pins(&dir).unwrap();
        f.profiles.insert(id.into(), PinState { salt: hex(&SALT), fails: 0, until: 0 });
        write_salt_copy(&dir, db_file, &SALT).unwrap();
        write_pins(&dir, &f).unwrap();
        dir
    }
}

#[cfg(test)]
mod tests {
    use super::testutil::*;
    use super::*;
    use crate::db::testutil::file_has;
    use crate::db::testutil::MARKER;

    #[test]
    fn espera_cresce_a_cada_rodada_de_5_erros() {
        let mut s = PinState { salt: "00".repeat(16), fails: 0, until: 0 };
        for r in [4, 3, 2, 1] { assert_eq!(register_failure(&mut s, 1000), Unlock::Wrong { remaining: r }); }
        assert_eq!(register_failure(&mut s, 1000), Unlock::Locked { until: 1060 });
        assert_eq!((locked_until(&s, 1059), locked_until(&s, 1060)), (Some(1060), None));
        let wait = |s: &mut PinState| { for _ in 0..4 { register_failure(s, 2000); } register_failure(s, 2000) };
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

    #[test]
    fn resultado_vai_para_o_js_com_kind() {
        assert_eq!(serde_json::to_string(&Unlock::Ok).unwrap(), r#"{"kind":"ok"}"#);
        assert_eq!(serde_json::to_string(&Unlock::Wrong { remaining: 3 }).unwrap(), r#"{"kind":"wrong","remaining":3}"#);
        assert_eq!(serde_json::to_string(&Unlock::Locked { until: 9 }).unwrap(), r#"{"kind":"locked","until":9}"#);
    }

    #[tokio::test]
    async fn reiniciar_nao_zera_a_espera() {
        let dir = cifrado("perfil-abcd1234.db", "1234").await;
        assert!(!file_has(&dir.join("perfil-abcd1234.db"), MARKER));
        for _ in 0..4 { assert!(matches!(check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "9999", 1000).await.unwrap().0, Unlock::Wrong { .. })); }
        assert_eq!(check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "9999", 1000).await.unwrap().0, Unlock::Locked { until: 1060 });
        // "reiniciar": o estado vem de novo do disco
        assert_eq!(read_pins(&dir).unwrap().profiles["abcd1234"], PinState { salt: hex(&SALT), fails: 5, until: 1060 });
    }

    #[tokio::test]
    async fn pin_certo_durante_a_espera_nao_abre() {
        let dir = cifrado("perfil-abcd1234.db", "1234").await;
        for _ in 0..5 { check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "9999", 1000).await.unwrap(); }
        let (r, keys) = check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "1234", 1030).await.unwrap();
        assert_eq!((r, keys.is_none()), (Unlock::Locked { until: 1060 }, true));
        let (r, keys) = check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "1234", 1060).await.unwrap();
        assert_eq!((r, keys.is_some()), (Unlock::Ok, true));
        assert_eq!(read_pins(&dir).unwrap().profiles["abcd1234"].fails, 0);
    }

    #[tokio::test]
    async fn sem_pins_json_o_sal_vem_da_copia() {
        let dir = cifrado("perfil-abcd1234.db", "1234").await; // o helper grava pins.json e a cópia <db>.salt
        std::fs::remove_file(dir.join(PINS_FILE)).unwrap();
        let (r, keys) = check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "1234", 1000).await.unwrap();
        assert_eq!((r, keys.is_some()), (Unlock::Ok, true));
        assert_eq!(read_pins(&dir).unwrap().profiles["abcd1234"].salt, hex(&SALT));
    }

    #[tokio::test]
    async fn pin_errado_nao_toca_no_banco() {
        let dir = cifrado("perfil-abcd1234.db", "1234").await;
        let antes = std::fs::read(dir.join("perfil-abcd1234.db")).unwrap();
        check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "9999", 1000).await.unwrap();
        assert_eq!(std::fs::read(dir.join("perfil-abcd1234.db")).unwrap(), antes);
        assert!(check_pin_in(&dir, "abcd1234", "yield.db", "1234", 1000).await.is_err());
        assert_eq!(check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "123", 1000).await.err().unwrap(), "O PIN tem 4 dígitos.");
    }

    #[tokio::test]
    async fn pins_ilegivel_ganha_copia_e_volta_pelas_copias_do_sal() {
        let dir = cifrado("perfil-abcd1234.db", "1234").await;
        for _ in 0..3 { check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "9999", 1000).await.unwrap(); }
        std::fs::write(dir.join(PINS_FILE), "{lixo").unwrap();
        // ilegível não tranca o perfil: o sal volta da cópia, sem a contagem de erros
        assert_eq!(read_pins(&dir).unwrap().profiles["abcd1234"], PinState { salt: hex(&SALT), fails: 0, until: 0 });
        let copias: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with("pins.json.ilegivel-")).collect();
        assert_eq!(copias.len(), 1);
        assert_eq!(std::fs::read_to_string(copias[0].path()).unwrap(), "{lixo");
        let (r, keys) = check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "1234", 1000).await.unwrap();
        assert_eq!((r, keys.is_some()), (Unlock::Ok, true));
    }

    #[tokio::test]
    async fn sem_entrada_e_sem_copia_do_sal_nao_abre() {
        let dir = cifrado("perfil-abcd1234.db", "1234").await;
        std::fs::remove_file(dir.join(PINS_FILE)).unwrap();
        std::fs::remove_file(salt_copy(&dir, "perfil-abcd1234.db")).unwrap();
        assert_eq!(
            check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "1234", 1000).await.err().unwrap(),
            "Não encontrei o sal do PIN deste perfil em pins.json; sem ele o banco não abre."
        );
    }

    #[tokio::test]
    async fn chave_do_banco_ao_abrir() {
        let _g = globals();
        let claro = em_claro("yield.db").await;
        assert_eq!(key_for(&claro, "yield.db").unwrap(), None);
        // sem nenhum perfil ativado vale o `principal` (yield.db)
        let dir = cifrado("yield.db", "1234").await;
        assert_eq!(key_for(&dir, "yield.db").unwrap_err(), "Perfil bloqueado: digite o PIN.");
        let keys = derive("1234", &SALT).unwrap();
        *UNLOCKED.lock().unwrap() = Some(("principal".into(), keys.clone()));
        assert_eq!(key_for(&dir, "yield.db").unwrap(), Some(keys.db));
        assert_eq!(vault_key_for("principal"), Some(keys.vault));
        assert_eq!(vault_key_for("abcd1234"), None);
        *UNLOCKED.lock().unwrap() = None;
        std::fs::remove_file(dir.join(PINS_FILE)).unwrap();
        std::fs::remove_file(salt_copy(&dir, "yield.db")).unwrap();
        assert_eq!(key_for(&dir, "yield.db").unwrap_err(), CORRUPT);
        // erro de leitura do pins.json não vira "corrompido"
        std::fs::create_dir(dir.join(PINS_FILE)).unwrap();
        assert_ne!(key_for(&dir, "yield.db").unwrap_err(), CORRUPT);
    }

    #[tokio::test]
    async fn tentativas_em_paralelo_contam_uma_a_uma() {
        let dir = cifrado("perfil-abcd1234.db", "1234").await;
        let t = || check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "9999", 1000);
        let r = tokio::join!(t(), t(), t(), t(), t());
        let locked = [r.0, r.1, r.2, r.3, r.4].into_iter().filter(|r| matches!(r.as_ref().unwrap().0, Unlock::Locked { .. })).count();
        assert_eq!(locked, 1);
        assert_eq!(read_pins(&dir).unwrap().profiles["abcd1234"], PinState { salt: hex(&SALT), fails: 5, until: 1060 });
    }

    #[tokio::test]
    async fn sal_estragado_volta_da_copia_sem_zerar_a_espera() {
        let dir = cifrado("perfil-abcd1234.db", "1234").await;
        for _ in 0..5 { check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "9999", 1000).await.unwrap(); }
        let mut f = read_pins(&dir).unwrap();
        f.profiles.get_mut("abcd1234").unwrap().salt = "zz".into();
        write_pins(&dir, &f).unwrap();
        assert_eq!(check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "1234", 1000).await.unwrap().0, Unlock::Locked { until: 1060 });
        assert_eq!(check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "1234", 1060).await.unwrap().0, Unlock::Ok);
        assert_eq!(read_pins(&dir).unwrap().profiles["abcd1234"].salt, hex(&SALT));
    }

    #[tokio::test]
    async fn desbloquear_refaz_a_copia_do_sal() {
        let dir = cifrado("perfil-abcd1234.db", "1234").await;
        std::fs::remove_file(salt_copy(&dir, "perfil-abcd1234.db")).unwrap();
        check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "9999", 1000).await.unwrap();
        assert_eq!(read_salt_copy(&dir, "perfil-abcd1234.db"), None); // PIN errado não grava nada fora do pins.json
        check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "1234", 1000).await.unwrap();
        assert_eq!(read_salt_copy(&dir, "perfil-abcd1234.db"), Some(SALT));
    }
}
