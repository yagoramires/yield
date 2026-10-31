use crate::db::{cipher_version, commit_swap, export_verified, has_pin_file, key_opens, open_pool, pin_tmp, Dbs, Key, CORRUPT};
use crate::{active, is_safety_copy_of, remove_if_exists, valid_profile, write_atomic, LEGACY_DB, LEGACY_ID, RESTORE_FILE};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};

/// Argon2id(PIN, sal) → 64 bytes: os 32 primeiros abrem o banco, os outros 32 o item do cofre.
#[derive(Clone)]
pub struct Keys {
    pub db: Key,
    pub vault: Key,
}

pub const PINS_FILE: &str = "pins.json";
const PER_ROUND: u32 = 5;
const WAITS: [u64; 4] = [60, 300, 900, 3600];
pub(crate) const LOCKED: &str = "Perfil bloqueado: digite o PIN.";

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
// ligar, trocar e tirar o PIN (e exportar e restaurar o backup) um de cada vez: duas trocas cruzadas deixariam o cofre com a chave de um PIN que já não abre o banco
pub(crate) static PIN_OPS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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

pub fn unhex(s: &str) -> Option<Vec<u8>> {
    // o from_str_radix aceitaria um "+" na frente
    if !s.len().is_multiple_of(2) || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
}

fn salt_from_hex(s: &str) -> Option<[u8; 16]> {
    unhex(s)?.try_into().ok()
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
    // pins.json ilegível não esconde os perfis: "tem PIN" vem do cabeçalho; só a espera fica sem saber
    let pins = read_pins(&dir).ok();
    let now = now()?;
    let mut out = HashMap::new();
    for p in profiles.into_iter().filter(|p| valid_profile(&p.id, &p.db_file)) {
        // um arquivo ilegível não derruba a lista: o db_load dele é que vai dizer o erro
        let Ok(has_pin) = has_pin_file(&dir.join(&p.db_file)) else { continue };
        let until = pins.as_ref().and_then(|f| f.profiles.get(&p.id)).and_then(|s| locked_until(s, now));
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

/// Lê, muda e grava o `pins.json` sob a trava das tentativas de PIN; `change` diz se mudou (sem mudança não grava).
pub(crate) async fn update_pins(dir: &Path, change: impl FnOnce(&mut PinsFile) -> bool) -> Result<(), String> {
    let _checking = CHECKING.lock().await;
    let mut f = read_pins(dir)?;
    if change(&mut f) {
        write_pins(dir, &f)?;
    }
    Ok(())
}

fn file_of(id: &str) -> Option<String> {
    let db_file = if id == LEGACY_ID { LEGACY_DB.into() } else { format!("perfil-{id}.db") };
    valid_profile(id, &db_file).then_some(db_file)
}

/// No startup: entrada no `pins.json` com o banco em claro é um crash entre a troca do arquivo e o `pins.json`; sai, senão todo PIN contaria como erro.
pub async fn forget_plain_pins(dir: &Path) -> Result<(), String> {
    let plain = |id: &str| file_of(id).is_some_and(|f| crate::starts_with(&dir.join(f), crate::SQLITE_MAGIC).unwrap_or(false));
    update_pins(dir, |f| {
        let before = f.profiles.len();
        f.profiles.retain(|id, _| !plain(id));
        f.profiles.len() != before
    })
    .await
}

/// Recria o banco com a chave `to` em `<db_file>.pin-tmp`, confere e troca pelo original.
pub async fn rekey_in(dir: &Path, db_file: &str, from: Option<&Key>, to: Option<&Key>) -> Result<(), String> {
    let tmp = pin_tmp(dir, db_file);
    export_verified(&dir.join(db_file), from, &tmp, to).await?;
    commit_swap(dir, db_file, &tmp).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

/// Apaga as cópias de segurança do restore (`seguranca-*`) de `db_file`; com `only_plain`, só as que não estão cifradas pelo PIN.
pub(crate) fn remove_safety_copies(dir: &Path, db_file: &str, only_plain: bool) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(err)? {
        let path = entry.map_err(err)?.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()).filter(|n| is_safety_copy_of(n, db_file)) else { continue };
        // o `-wal`/`-shm` segue o `.db` da cópia: cifrado junto com ele, ou em claro
        let base = dir.join(name.trim_end_matches("-wal").trim_end_matches("-shm"));
        if !only_plain || !has_pin_file(&base).unwrap_or(true) {
            remove_if_exists(&path)?;
        }
    }
    Ok(())
}

/// Com o PIN ligado, as cópias em claro do banco não ficam no disco (as cifradas, de um restore com PIN, ficam).
pub fn remove_plain_safety_copies(dir: &Path, db_file: &str) -> Result<(), String> {
    remove_safety_copies(dir, db_file, true)
}

/// No startup: cópia em claro de perfil com PIN é sobra de um ligar que caiu ou falhou antes de apagá-las.
pub fn sweep_plain_copies(dir: &Path) {
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if id_of(&name).is_some() && has_pin_file(&entry.path()).unwrap_or(false) {
            let _ = remove_plain_safety_copies(dir, &name);
        }
    }
}

/// Trava das operações de PIN (e da exportação e restauração do backup) para quem não pode esperar (gravar o cofre, trocar de perfil): no meio de uma delas, recusa.
pub(crate) fn pin_ops_idle() -> Result<tokio::sync::MutexGuard<'static, ()>, String> {
    PIN_OPS.try_lock().map_err(|_| "Operação no banco em andamento; tente de novo em instantes.".to_string())
}

/// O PIN só muda no perfil aberto.
fn only_active(id: &str, db_file: &str) -> Result<(), String> {
    if !valid_profile(id, db_file) || active()?.0 != id {
        return Err("Perfil inválido.".into());
    }
    Ok(())
}

async fn derive_async(pin: &str, salt: [u8; 16]) -> Result<Keys, String> {
    let pin = pin.to_owned();
    tauri::async_runtime::spawn_blocking(move || derive(&pin, &salt)).await.map_err(err)?
}

async fn reseal(id: &str, from: Option<Key>, to: Option<Key>) -> Result<(), String> {
    let id = id.to_owned();
    tauri::async_runtime::spawn_blocking(move || crate::reseal_vault(&id, from.as_ref(), to.as_ref())).await.map_err(err)?
}

/// Depois da troca o PIN novo já vale: o que falhar daqui em diante não desfaz nada nem vira erro para quem chamou.
/// O cofre se recifra na próxima leitura (o cache sai), o pins.json e as cópias se acertam no próximo startup.
fn after_swap(r: Result<(), String>) {
    if let Err(e) = r {
        eprintln!("PIN: {e}");
        *crate::VAULT.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

fn set_unlocked(v: Option<(String, Keys)>) {
    // trava envenenada não impede de trocar as chaves: o banco já está com a chave nova
    *UNLOCKED.lock().unwrap_or_else(|e| e.into_inner()) = v;
}

/// Fecha o pool do banco, roda `op` e reabre com a chave do estado final, também se `op` falhar: o `db` do DataProvider segue valendo.
/// Segura a trava dos pools o tempo todo: nenhum `db_load` abre o arquivo no meio da troca. Devolve (op, reabertura).
async fn with_pool_closed(
    dbs: &Dbs,
    dir: &Path,
    db_file: &str,
    op: impl std::future::Future<Output = Result<(), String>>,
) -> (Result<(), String>, Result<(), String>) {
    let mut map = dbs.0.lock().await;
    if let Some(p) = map.remove(db_file) {
        p.close().await;
    }
    let r = op.await;
    let reopened = match key_for(dir, db_file) {
        Ok(key) => open_pool(&dir.join(db_file), key.as_ref()).await.map(|p| {
            map.insert(db_file.into(), p);
        }),
        Err(e) => Err(e),
    };
    (r, reopened)
}

pub async fn set_pin_in(dbs: &Dbs, dir: &Path, id: &str, db_file: &str, pin: &str) -> Result<(), String> {
    let _op = PIN_OPS.lock().await;
    only_active(id, db_file)?;
    if !valid_pin(pin) {
        return Err("O PIN tem 4 dígitos.".into());
    }
    if !pin_supported().await {
        return Err("PIN indisponível nesta instalação: o Yield não encontrou a criptografia do banco (SQLCipher).".into());
    }
    if has_pin_file(&dir.join(db_file))? {
        return Err("Este perfil já tem PIN.".into());
    }
    // o sal no disco antes do banco cifrado: um crash depois do rename não deixa o banco sem sal
    let mut salt = [0u8; 16];
    update_pins(dir, |f| {
        salt = f.profiles.get(id).and_then(|s| salt_from_hex(&s.salt)).unwrap_or_else(|| {
            use aes_gcm::aead::{rand_core::RngCore, OsRng};
            let mut new = [0u8; 16];
            OsRng.fill_bytes(&mut new);
            new
        });
        f.profiles.insert(id.into(), PinState { salt: hex(&salt), fails: 0, until: 0 });
        true
    })
    .await?;
    write_salt_copy(dir, db_file, &salt)?;
    let keys = derive_async(pin, salt).await?;
    let (swapped, reopened) = with_pool_closed(dbs, dir, db_file, async {
        rekey_in(dir, db_file, None, Some(&keys.db)).await?;
        set_unlocked(Some((id.into(), keys.clone())));
        Ok(())
    })
    .await;
    if let Err(e) = swapped {
        // o banco segue em claro: o pins.json volta a dizer o mesmo
        let _ = update_pins(dir, |f| f.profiles.remove(id).is_some()).await;
        return Err(e);
    }
    // as cópias em claro antes do cofre: um cofre que falhe (Keychain negado) não as deixa no disco
    after_swap(remove_plain_safety_copies(dir, db_file));
    after_swap(reseal(id, None, Some(keys.vault)).await);
    after_swap(reopened);
    Ok(())
}

/// Confere o PIN atual (conta no limite) e deixa as chaves dele como as do perfil desbloqueado; `Err(resultado)` se não abriu.
async fn current_keys(dir: &Path, id: &str, db_file: &str, current: &str, now: u64) -> Result<Result<Keys, Unlock>, String> {
    only_active(id, db_file)?;
    if !has_pin_file(&dir.join(db_file))? {
        return Err("Este perfil não tem PIN.".into());
    }
    let (result, keys) = check_pin_in(dir, id, db_file, current, now).await?;
    let Some(keys) = keys else { return Ok(Err(result)) };
    set_unlocked(Some((id.into(), keys.clone())));
    Ok(Ok(keys))
}

pub async fn change_pin_in(dbs: &Dbs, dir: &Path, id: &str, db_file: &str, current: &str, next: &str, now: u64) -> Result<Unlock, String> {
    if !valid_pin(next) {
        return Err("O PIN tem 4 dígitos.".into());
    }
    let _op = PIN_OPS.lock().await;
    let old = match current_keys(dir, id, db_file, current, now).await? {
        Ok(keys) => keys,
        Err(result) => return Ok(result),
    };
    // o mesmo sal: o check_pin_in acabou de gravá-lo no pins.json
    let salt = read_pins(dir)?.profiles.get(id).and_then(|s| salt_from_hex(&s.salt)).ok_or(CORRUPT)?;
    let next = derive_async(next, salt).await?;
    // o cofre em claro durante a troca: um crash no meio não o deixa cifrado com uma chave que nenhum PIN gera
    reseal(id, Some(old.vault), None).await?;
    let (swapped, reopened) = with_pool_closed(dbs, dir, db_file, async {
        rekey_in(dir, db_file, Some(&old.db), Some(&next.db)).await?;
        set_unlocked(Some((id.into(), next.clone())));
        Ok(())
    })
    .await;
    if let Err(e) = swapped {
        // o banco segue com o PIN atual: o cofre volta a ser dele
        let _ = reseal(id, None, Some(old.vault)).await;
        return Err(e);
    }
    after_swap(reseal(id, None, Some(next.vault)).await);
    after_swap(reopened);
    Ok(Unlock::Ok)
}

pub async fn remove_pin_in(dbs: &Dbs, dir: &Path, id: &str, db_file: &str, current: &str, now: u64) -> Result<Unlock, String> {
    let _op = PIN_OPS.lock().await;
    let old = match current_keys(dir, id, db_file, current, now).await? {
        Ok(keys) => keys,
        Err(result) => return Ok(result),
    };
    reseal(id, Some(old.vault), None).await?;
    let (swapped, reopened) = with_pool_closed(dbs, dir, db_file, async {
        rekey_in(dir, db_file, Some(&old.db), None).await?;
        set_unlocked(None);
        Ok(())
    })
    .await;
    if let Err(e) = swapped {
        let _ = reseal(id, None, Some(old.vault)).await;
        return Err(e);
    }
    after_swap(update_pins(dir, |f| f.profiles.remove(id).is_some()).await);
    after_swap(remove_if_exists(&salt_copy(dir, db_file)));
    after_swap(reopened);
    Ok(Unlock::Ok)
}

#[tauri::command]
pub async fn profile_set_pin(app: tauri::AppHandle, state: State<'_, Dbs>, id: String, db_file: String, pin: String) -> Result<(), String> {
    set_pin_in(&state, &app.path().app_config_dir().map_err(err)?, &id, &db_file, &pin).await
}

#[tauri::command]
pub async fn profile_change_pin(app: tauri::AppHandle, state: State<'_, Dbs>, id: String, db_file: String, current: String, next: String) -> Result<Unlock, String> {
    change_pin_in(&state, &app.path().app_config_dir().map_err(err)?, &id, &db_file, &current, &next, now()?).await
}

#[tauri::command]
pub async fn profile_remove_pin(app: tauri::AppHandle, state: State<'_, Dbs>, id: String, db_file: String, current: String) -> Result<Unlock, String> {
    remove_pin_in(&state, &app.path().app_config_dir().map_err(err)?, &id, &db_file, &current, now()?).await
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

    /// Nunca o Keychain de verdade: o mock, ou um cofre que sempre falha (como o pedido de senha do macOS negado).
    pub fn keychain(works: bool) {
        struct Negado;
        impl keyring::credential::CredentialBuilderApi for Negado {
            fn build(&self, _: Option<&str>, _: &str, _: &str) -> keyring::Result<Box<keyring::credential::Credential>> {
                Err(keyring::Error::NoStorageAccess("negado".into()))
            }
            fn as_any(&self) -> &dyn std::any::Any {
                self
            }
        }
        keyring::set_default_credential_builder(if works { keyring::mock::default_credential_builder() } else { Box::new(Negado) });
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
    use crate::db::testutil::{file_has, is_plain_header, tmp, MARKER};
    use crate::db::{cleanup_pin_tmp, select};

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

    #[tokio::test]
    async fn ligar_pin_nao_deixa_texto_claro() {
        let dir = em_claro("perfil-abcd1234.db").await;
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
        let dir = cifrado("perfil-abcd1234.db", "1234").await;
        let (a, b) = (derive("1234", &SALT).unwrap(), derive("5678", &SALT).unwrap());
        let db = dir.join("perfil-abcd1234.db");
        rekey_in(&dir, "perfil-abcd1234.db", Some(&a.db), Some(&b.db)).await.unwrap();
        assert!(!key_opens(&db, &a.db).await.unwrap() && key_opens(&db, &b.db).await.unwrap());
        rekey_in(&dir, "perfil-abcd1234.db", Some(&b.db), None).await.unwrap();
        assert!(is_plain_header(&db) && file_has(&db, MARKER));
    }

    #[tokio::test]
    async fn crash_antes_do_rename_mantem_o_banco_antigo() {
        let dir = em_claro("perfil-abcd1234.db").await;
        let db = dir.join("perfil-abcd1234.db");
        let k = derive("1234", &SALT).unwrap();
        let tmp = pin_tmp(&dir, "perfil-abcd1234.db");
        export_verified(&db, None, &tmp, Some(&k.db)).await.unwrap(); // "crash" aqui
        cleanup_pin_tmp(&dir); // próximo startup
        assert!(!tmp.exists());
        assert!(is_plain_header(&db) && file_has(&db, MARKER));
        let pool = open_pool(&db, None).await.unwrap();
        assert_eq!(select(&pool, "SELECT v FROM t", vec![]).await.unwrap()[0]["v"], MARKER);
        pool.close().await;
        // trocando o PIN: o original segue abrindo com a chave antiga
        let dir = cifrado("perfil-abcd1234.db", "1234").await;
        let db = dir.join("perfil-abcd1234.db");
        let tmp = pin_tmp(&dir, "perfil-abcd1234.db");
        export_verified(&db, Some(&k.db), &tmp, Some(&derive("5678", &SALT).unwrap().db)).await.unwrap();
        std::fs::write(dir.join("perfil-abcd1234.db.pin-tmp-journal"), "x").unwrap();
        cleanup_pin_tmp(&dir);
        assert!(!tmp.exists() && !dir.join("perfil-abcd1234.db.pin-tmp-journal").exists());
        let pool = open_pool(&db, Some(&k.db)).await.unwrap();
        assert_eq!(select(&pool, "SELECT v FROM t", vec![]).await.unwrap()[0]["v"], MARKER);
    }

    #[tokio::test]
    async fn erro_na_copia_nao_deixa_o_temporario() {
        let dir = cifrado("perfil-abcd1234.db", "1234").await;
        let tmp = pin_tmp(&dir, "perfil-abcd1234.db");
        let errada = derive("9999", &SALT).unwrap();
        assert!(rekey_in(&dir, "perfil-abcd1234.db", Some(&errada.db), None).await.is_err());
        assert!(!tmp.exists() && key_opens(&dir.join("perfil-abcd1234.db"), &derive("1234", &SALT).unwrap().db).await.unwrap());
    }

    #[tokio::test]
    async fn crash_depois_do_rename_vale_o_cabecalho() {
        let dir = em_claro("perfil-abcd1234.db").await;
        let mut f = PinsFile::default();
        f.profiles.insert("abcd1234".into(), PinState { salt: hex(&SALT), fails: 0, until: 0 }); // sal gravado antes do swap
        write_pins(&dir, &f).unwrap();
        rekey_in(&dir, "perfil-abcd1234.db", None, Some(&derive("1234", &SALT).unwrap().db)).await.unwrap(); // "crash": cofre não regravado
        assert!(has_pin_file(&dir.join("perfil-abcd1234.db")).unwrap());
        assert_eq!(check_pin_in(&dir, "abcd1234", "perfil-abcd1234.db", "1234", 1000).await.unwrap().0, Unlock::Ok);
    }

    #[tokio::test]
    async fn troca_recusa_journal_quente() {
        let dir = em_claro("perfil-abcd1234.db").await;
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

    #[tokio::test]
    async fn startup_tira_do_pins_json_o_perfil_em_claro() {
        let dir = em_claro("perfil-abcd1234.db").await;
        forget_plain_pins(&dir).await.unwrap();
        assert!(!dir.join(PINS_FILE).exists()); // quem não usa PIN não ganha pins.json
        let pool = open_pool(&dir.join("yield.db"), Some(&derive("1234", &SALT).unwrap().db)).await.unwrap();
        crate::db::execute(&pool, "CREATE TABLE t (v TEXT)", vec![]).await.unwrap();
        pool.close().await;
        let mut f = PinsFile::default();
        for id in ["abcd1234", "principal", "zzzz9999"] {
            f.profiles.insert(id.into(), PinState { salt: hex(&SALT), fails: 2, until: 0 });
        }
        write_pins(&dir, &f).unwrap();
        forget_plain_pins(&dir).await.unwrap();
        // o em claro sai; o cifrado e o de arquivo ausente ficam
        assert_eq!(read_pins(&dir).unwrap().profiles.keys().collect::<Vec<_>>(), ["principal", "zzzz9999"]);
    }

    #[tokio::test]
    async fn ligar_trocar_e_tirar_pelo_comando() {
        let _g = globals();
        keychain(true);
        let (id, file) = ("abcd1234", "perfil-abcd1234.db");
        let dir = em_claro(file).await;
        let db = dir.join(file);
        std::fs::write(dir.join("seguranca-perfil-abcd1234-1793000000.db"), "x").unwrap();
        let dbs = Dbs::default();
        crate::set_active(id.into(), file.into()).unwrap();
        crate::db::load_in(&dbs, &dir, file).await.unwrap();
        let marker = |dbs: &Dbs| {
            let pool = dbs.0.try_lock().unwrap().get(file).cloned().unwrap();
            async move { select(&pool, "SELECT v FROM t", vec![]).await.unwrap()[0]["v"].clone() }
        };
        assert_eq!(set_pin_in(&dbs, &dir, "zzzz9999", "perfil-zzzz9999.db", "1234").await.unwrap_err(), "Perfil inválido.");

        set_pin_in(&dbs, &dir, id, file, "1234").await.unwrap();
        let salt = salt_from_hex(&read_pins(&dir).unwrap().profiles[id].salt).unwrap();
        assert_eq!(read_salt_copy(&dir, file), Some(salt));
        assert!(has_pin_file(&db).unwrap() && !file_has(&db, MARKER));
        assert!(!dir.join("seguranca-perfil-abcd1234-1793000000.db").exists());
        assert_eq!(marker(&dbs).await, MARKER); // o pool voltou aberto, com a chave nova
        assert_eq!(set_pin_in(&dbs, &dir, id, file, "1234").await.unwrap_err(), "Este perfil já tem PIN.");

        let antes = std::fs::read(&db).unwrap();
        assert!(matches!(change_pin_in(&dbs, &dir, id, file, "9999", "5678", 1000).await.unwrap(), Unlock::Wrong { .. }));
        assert_eq!(std::fs::read(&db).unwrap(), antes);
        assert_eq!(change_pin_in(&dbs, &dir, id, file, "1234", "5678", 1000).await.unwrap(), Unlock::Ok);
        assert!(key_opens(&db, &derive("5678", &salt).unwrap().db).await.unwrap());
        assert_eq!(read_pins(&dir).unwrap().profiles[id].fails, 0);
        assert_eq!(marker(&dbs).await, MARKER);

        assert_eq!(remove_pin_in(&dbs, &dir, id, file, "5678", 1000).await.unwrap(), Unlock::Ok);
        assert!(is_plain_header(&db) && !read_pins(&dir).unwrap().profiles.contains_key(id) && read_salt_copy(&dir, file).is_none());
        assert!(UNLOCKED.lock().unwrap().is_none());
        assert_eq!(marker(&dbs).await, MARKER);
        assert_eq!(remove_pin_in(&dbs, &dir, id, file, "5678", 1000).await.unwrap_err(), "Este perfil não tem PIN.");
        *crate::ACTIVE.lock().unwrap() = None;
    }

    #[tokio::test]
    async fn keychain_negado_nao_deixa_copias_em_claro_e_o_pin_vale() {
        let _g = globals();
        keychain(false);
        let (id, file) = ("abcd1234", "perfil-abcd1234.db");
        let dir = em_claro(file).await;
        std::fs::write(dir.join("seguranca-perfil-abcd1234-1793000000.db"), "x").unwrap();
        crate::set_active(id.into(), file.into()).unwrap();
        *crate::VAULT.lock().unwrap() = Some(crate::Vault::default());
        set_pin_in(&Dbs::default(), &dir, id, file, "1234").await.unwrap();
        assert!(has_pin_file(&dir.join(file)).unwrap() && !dir.join("seguranca-perfil-abcd1234-1793000000.db").exists());
        assert!(crate::VAULT.lock().unwrap().is_none()); // a próxima leitura do cofre recifra
        keychain(true);
        set_unlocked(None);
        *crate::ACTIVE.lock().unwrap() = None;
    }

    #[tokio::test]
    async fn startup_apaga_copias_em_claro_de_perfil_com_pin() {
        let dir = cifrado("perfil-abcd1234.db", "1234").await;
        let cifrada = "seguranca-perfil-abcd1234-1793000001.db"; // de um restore com PIN: fica
        std::fs::copy(dir.join("perfil-abcd1234.db"), dir.join(cifrada)).unwrap();
        let claras = ["seguranca-perfil-abcd1234-1793000000.db", "seguranca-perfil-abcd1234-1793000000.db-wal"];
        for f in claras { std::fs::write(dir.join(f), "x").unwrap(); }
        let pool = open_pool(&dir.join("perfil-zzzz9999.db"), None).await.unwrap(); // perfil sem PIN: as cópias dele ficam
        crate::db::execute(&pool, "CREATE TABLE t (v TEXT)", vec![]).await.unwrap();
        pool.close().await;
        std::fs::write(dir.join("seguranca-perfil-zzzz9999-1793000000.db"), "x").unwrap();
        sweep_plain_copies(&dir);
        assert!(claras.iter().all(|f| !dir.join(f).exists()));
        assert!(dir.join(cifrada).exists() && dir.join("seguranca-perfil-zzzz9999-1793000000.db").exists());
    }

    #[tokio::test]
    async fn troca_que_falha_deixa_tudo_como_estava() {
        let _g = globals();
        keychain(true);
        let (id, file) = ("abcd1234", "perfil-abcd1234.db");
        let dir = em_claro(file).await;
        let db = dir.join(file);
        let dbs = Dbs::default();
        crate::set_active(id.into(), file.into()).unwrap();
        crate::db::load_in(&dbs, &dir, file).await.unwrap();
        let marker = |dbs: &Dbs| {
            let pool = dbs.0.try_lock().unwrap().get(file).cloned().unwrap();
            async move { select(&pool, "SELECT v FROM t", vec![]).await.unwrap()[0]["v"].clone() }
        };
        let trava = pin_tmp(&dir, file);
        std::fs::create_dir(&trava).unwrap(); // o temporário não sai: a cópia falha
        assert!(set_pin_in(&dbs, &dir, id, file, "1234").await.is_err());
        assert!(is_plain_header(&db) && !read_pins(&dir).unwrap().profiles.contains_key(id) && UNLOCKED.lock().unwrap().is_none());
        assert_eq!(marker(&dbs).await, MARKER);

        std::fs::remove_dir(&trava).unwrap();
        set_pin_in(&dbs, &dir, id, file, "1234").await.unwrap();
        let old = derive("1234", &salt_from_hex(&read_pins(&dir).unwrap().profiles[id].salt).unwrap()).unwrap();
        std::fs::create_dir(&trava).unwrap();
        assert!(change_pin_in(&dbs, &dir, id, file, "1234", "5678", 1000).await.is_err());
        assert!(key_opens(&db, &old.db).await.unwrap());
        assert_eq!(vault_key_for(id), Some(old.vault)); // as chaves na memória seguem as do PIN que abre o banco
        assert_eq!(marker(&dbs).await, MARKER);
        std::fs::remove_dir(&trava).unwrap();
        set_unlocked(None);
        *crate::ACTIVE.lock().unwrap() = None;
    }
}
