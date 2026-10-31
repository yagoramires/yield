#[cfg(target_os = "macos")]
use tauri::Emitter;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

mod ai;
mod db;
mod pin;

/// Troca o banco `db_name` em `dir` pelo conteúdo de `source`; devolve o caminho da cópia de segurança.
fn swap_in_dir(dir: &Path, source: &Path, db_name: &str) -> Result<PathBuf, String> {
    let err = |e: std::io::Error| e.to_string();
    let db = dir.join(db_name);
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
    // com o nome do banco: apagar o perfil apaga também as cópias dele
    let backup = dir.join(format!("seguranca-{}-{secs}.db", db_stem(db_name)));
    std::fs::copy(&db, &backup).map_err(err)?;
    // WAL não checkpointado: preserva ao lado da cópia para não perder transações recentes
    let wal = dir.join(format!("{db_name}-wal"));
    if wal.exists() {
        let mut wal_copy = backup.clone().into_os_string();
        wal_copy.push("-wal");
        std::fs::copy(&wal, wal_copy).map_err(err)?;
    }
    let tmp = dir.join(format!("{db_name}.novo"));
    std::fs::copy(source, &tmp).map_err(err)?;
    for ext in ["-wal", "-shm"] {
        remove_if_exists(&dir.join(format!("{db_name}{ext}")))?;
    }
    std::fs::rename(&tmp, &db).map_err(err)?;
    Ok(backup)
}

fn db_stem(db_file: &str) -> &str {
    db_file.strip_suffix(".db").unwrap_or(db_file)
}

/// Cópia do `swap_in_dir` para `db_file` (`seguranca-<stem>-<secs>.db*`); as sem stem, das versões antigas, eram sempre do `yield.db`.
fn is_safety_copy_of(name: &str, db_file: &str) -> bool {
    let rest = name.strip_prefix(&format!("seguranca-{}-", db_stem(db_file)));
    let rest = rest.or_else(|| if db_file == LEGACY_DB { name.strip_prefix("seguranca-") } else { None });
    match rest.and_then(|r| r.split_once('.')) {
        Some((secs, ext)) => !secs.is_empty() && secs.bytes().all(|b| b.is_ascii_digit()) && matches!(ext, "db" | "db-wal" | "db-shm"),
        None => false,
    }
}

fn remove_if_exists(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Troca o banco do perfil aberto pelo `restore.db` que o `backup_open` preparou e o JS já validou.
#[tauri::command]
fn swap_database(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let source = dir.join(RESTORE_FILE);
    if !starts_with(&source, SQLITE_MAGIC)? {
        return Err("Este arquivo não é um backup do Yield.".into());
    }
    let backup = swap_in_dir(&dir, &source, &active()?.1)?;
    let _ = std::fs::remove_file(&source); // o backup aberto, sem senha: já está no banco
    Ok(backup.to_string_lossy().into_owned())
}

// Backup com senha: "YIELDBK1" + sal (16) + nonce (12) + AES-256-GCM(banco), chave = Argon2id(senha, sal).
const BACKUP_MAGIC: &[u8; 8] = b"YIELDBK1";
const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";

fn starts_with(path: &Path, magic: &[u8]) -> Result<bool, String> {
    use std::io::Read;
    let mut head = vec![0u8; magic.len()];
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let n = f.read(&mut head).map_err(|e| e.to_string())?;
    Ok(n == magic.len() && head == magic)
}

fn backup_key(password: &str, salt: &[u8]) -> Result<aes_gcm::Key<aes_gcm::Aes256Gcm>, String> {
    let mut key = [0u8; 32];
    argon2::Argon2::default().hash_password_into(password.as_bytes(), salt, &mut key).map_err(|e| e.to_string())?;
    Ok(key.into())
}

fn seal(plain: &[u8], password: &str) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::{rand_core::RngCore, Aead, AeadCore, KeyInit, OsRng};
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let nonce = aes_gcm::Aes256Gcm::generate_nonce(&mut OsRng);
    let cipher = aes_gcm::Aes256Gcm::new(&backup_key(password, &salt)?);
    let body = cipher.encrypt(&nonce, plain).map_err(|_| "Não foi possível criptografar o backup".to_string())?;
    Ok([BACKUP_MAGIC.as_slice(), &salt, nonce.as_slice(), &body].concat())
}

fn unseal(data: &[u8], password: &str) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::{Aead, KeyInit};
    if data.len() < 36 || !data.starts_with(BACKUP_MAGIC) {
        return Err("Este arquivo não é um backup do Yield com senha.".into());
    }
    let (salt, rest) = data[8..].split_at(16);
    let (nonce, body) = rest.split_at(12);
    let cipher = aes_gcm::Aes256Gcm::new(&backup_key(password, salt)?);
    cipher.decrypt(nonce.into(), body).map_err(|_| "Senha errada ou arquivo corrompido.".to_string())
}

/// O temporário do VACUUM INTO: `export-*.db` direto na pasta de dados do app.
fn is_export_tmp(data_dir: &Path, path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    path.parent() == Some(data_dir) && name.starts_with("export-") && name.ends_with(".db")
}

/// Os caminhos vêm do webview: `from` só pode ser o temporário (ele é apagado)
/// e `to` só um `.yield` novo ou outro backup com senha (ele é sobrescrito).
fn check_export(data_dir: &Path, from: &Path, to: &Path) -> Result<(), String> {
    if !is_export_tmp(data_dir, from) {
        return Err("Origem do backup fora da pasta do Yield.".into());
    }
    let yield_ext = to.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("yield"));
    if !yield_ext || (to.exists() && !starts_with(to, BACKUP_MAGIC)?) {
        // o temporário é o banco inteiro sem senha: não fica para trás
        let _ = std::fs::remove_file(from);
        return Err("Escolha um arquivo .yield novo ou um backup do Yield para sobrescrever.".into());
    }
    Ok(())
}

/// Criptografa o banco exportado (`from`, temporário) em `to` e apaga o temporário.
#[tauri::command]
fn encrypt_backup(app: tauri::AppHandle, from: String, to: String, password: String) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    check_export(&data_dir, Path::new(&from), Path::new(&to))?;
    let plain = std::fs::read(&from).map_err(|e| e.to_string())?;
    let sealed = seal(&plain, &password);
    std::fs::remove_file(&from).map_err(|e| e.to_string())?;
    std::fs::write(&to, sealed?).map_err(|e| e.to_string())
}

#[tauri::command]
fn is_encrypted_backup(path: String) -> Result<bool, String> {
    starts_with(Path::new(&path), BACKUP_MAGIC)
}

/// Põe o backup escolhido em `restore.db` (o único arquivo fora do perfil que o `db_load` abre); `swap_database` apaga esse arquivo depois de usar.
fn backup_open_in(dir: &Path, from: &Path, password: Option<&str>) -> Result<(), String> {
    let out = dir.join(RESTORE_FILE);
    match password {
        Some(pw) => std::fs::write(&out, unseal(&std::fs::read(from).map_err(|e| e.to_string())?, pw)?),
        // backup antigo `.db`, sem senha
        None if starts_with(from, SQLITE_MAGIC)? => std::fs::copy(from, &out).map(|_| ()),
        None => return Err("Este arquivo não é um backup do Yield.".into()),
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn backup_open(app: tauri::AppHandle, path: String, password: Option<String>) -> Result<(), String> {
    backup_open_in(&app.path().app_config_dir().map_err(|e| e.to_string())?, Path::new(&path), password.as_deref())
}

const RESTORE_FILE: &str = "restore.db";

/// Apaga o `restore.db` (backup com senha já aberto, sem criptografia) quando a importação não vai até o fim.
fn discard_restore_in(dir: &Path) -> Result<(), String> {
    remove_if_exists(&dir.join(RESTORE_FILE))
}

#[tauri::command]
fn discard_restore(app: tauri::AppHandle) -> Result<(), String> {
    discard_restore_in(&app.path().app_config_dir().map_err(|e| e.to_string())?)
}

#[cfg(target_os = "macos")]
fn menu_pt(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem as P, Submenu};
    let about = AboutMetadata { name: Some("Yield".into()), version: Some(app.package_info().version.to_string()), ..Default::default() };
    let updates = MenuItem::with_id(app, "check-updates", "Procurar atualizações…", true, None::<&str>)?;
    let yield_menu = Submenu::with_items(app, "Yield", true, &[
        &P::about(app, Some("Sobre o Yield"), Some(about))?, &updates, &P::separator(app)?,
        &P::hide(app, Some("Ocultar o Yield"))?, &P::hide_others(app, Some("Ocultar outros"))?, &P::show_all(app, Some("Mostrar tudo"))?,
        &P::separator(app)?, &P::quit(app, Some("Sair do Yield"))?,
    ])?;
    let edit = Submenu::with_items(app, "Editar", true, &[
        &P::undo(app, Some("Desfazer"))?, &P::redo(app, Some("Refazer"))?, &P::separator(app)?,
        &P::cut(app, Some("Recortar"))?, &P::copy(app, Some("Copiar"))?, &P::paste(app, Some("Colar"))?, &P::select_all(app, Some("Selecionar tudo"))?,
    ])?;
    let window = Submenu::with_items(app, "Janela", true, &[
        &P::minimize(app, Some("Minimizar"))?, &P::maximize(app, Some("Zoom"))?, &P::fullscreen(app, Some("Tela cheia"))?,
        &P::separator(app)?, &P::close_window(app, Some("Fechar janela"))?,
    ])?;
    Menu::with_items(app, &[&yield_menu, &edit, &window])
}

// O perfil de hoje mantém os nomes antigos (banco, item do cofre); os novos têm id e arquivo próprios.
const LEGACY_ID: &str = "principal";
const LEGACY_DB: &str = "yield.db";
const PROFILES_FILE: &str = "perfis.json";

/// Id e arquivo vêm do webview: só vale o par que o próprio id gera (as regras do profiles.ts), nunca um caminho.
fn valid_profile(id: &str, db_file: &str) -> bool {
    if id == LEGACY_ID {
        return db_file == LEGACY_DB;
    }
    (8..=40).contains(&id.len())
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && db_file == format!("perfil-{id}.db")
}

// (id, arquivo do banco) do perfil aberto; sem nenhum ativado vale o de hoje.
static ACTIVE: std::sync::Mutex<Option<(String, String)>> = std::sync::Mutex::new(None);

fn active() -> Result<(String, String), String> {
    let a = ACTIVE.lock().map_err(|e| e.to_string())?;
    Ok(a.clone().unwrap_or_else(|| (LEGACY_ID.into(), LEGACY_DB.into())))
}

fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    use std::io::Write;
    let err = |e: std::io::Error| e.to_string();
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let mut f = std::fs::File::create(&tmp).map_err(err)?;
    f.write_all(contents.as_bytes()).map_err(err)?;
    // sem o fsync, uma queda de energia logo depois do rename pode deixar o arquivo vazio
    f.sync_all().map_err(err)?;
    std::fs::rename(&tmp, path).map_err(err)
}

/// Lê o `perfis.json` de `dir`. Ilegível, o JS regrava só com o `principal`: antes guarda uma cópia para os outros perfis não se perderem.
fn read_profiles_in(dir: &Path) -> Result<Option<String>, String> {
    let s = match std::fs::read_to_string(dir.join(PROFILES_FILE)) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if !s.trim().is_empty() && serde_json::from_str::<serde_json::Value>(&s).is_err() {
        let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
        std::fs::write(dir.join(format!("{PROFILES_FILE}.ilegivel-{secs}")), &s).map_err(|e| e.to_string())?;
    }
    Ok(Some(s))
}

#[tauri::command]
fn profiles_read(app: tauri::AppHandle) -> Result<Option<String>, String> {
    read_profiles_in(&app.path().app_config_dir().map_err(|e| e.to_string())?)
}

#[tauri::command]
fn profiles_write(app: tauri::AppHandle, json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json).map_err(|_| "Lista de perfis inválida.".to_string())?;
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(PROFILES_FILE), &json)
}

#[tauri::command]
async fn profile_activate(state: tauri::State<'_, db::Dbs>, id: String, db_file: String) -> Result<(), String> {
    activate_in(&state, id, db_file).await
}

async fn activate_in(dbs: &db::Dbs, id: String, db_file: String) -> Result<(), String> {
    set_active(id, db_file.clone())?;
    db::close_others(dbs, &db_file).await;
    Ok(())
}

fn set_active(id: String, db_file: String) -> Result<(), String> {
    if !valid_profile(&id, &db_file) {
        return Err("Perfil inválido.".into());
    }
    // com o cofre travado: nenhuma leitura ou gravação do cofre fica no meio da troca de perfil
    let mut cache = VAULT.lock().map_err(|e| e.to_string())?;
    // as chaves de outro perfil não ficam na memória depois da troca
    let mut unlocked = pin::UNLOCKED.lock().map_err(|e| e.to_string())?;
    if unlocked.as_ref().is_some_and(|(u, _)| *u != id) {
        *unlocked = None;
    }
    *ACTIVE.lock().map_err(|e| e.to_string())? = Some((id, db_file));
    *cache = None;
    Ok(())
}

/// Apaga o banco de um perfil que não está aberto (com `-wal`, `-shm` e as cópias de segurança do restore); arquivo ausente não é erro.
fn remove_profile_in(dir: &Path, id: &str, db_file: &str, active_id: &str) -> Result<(), String> {
    if !valid_profile(id, db_file) {
        return Err("Perfil inválido.".into());
    }
    if id == active_id {
        return Err("Não dá para apagar o perfil aberto.".into());
    }
    // o sal por último: sem ele um banco cifrado que sobrasse não abriria mais
    for ext in ["", "-wal", "-shm", "-journal", ".pin-tmp", ".pin-tmp-journal", ".pin-tmp-wal", ".pin-tmp-shm", ".salt"] {
        remove_if_exists(&dir.join(format!("{db_file}{ext}")))?;
    }
    pin::remove_plain_safety_copies(dir, db_file)
}

/// `Err`: algum arquivo ficou e o cofre nem foi tocado. `Ok(Some(erro))`: arquivos apagados, mas o item do cofre (ou a entrada no `pins.json`) ficou.
#[tauri::command]
async fn profile_remove_files(app: tauri::AppHandle, id: String, db_file: String) -> Result<Option<String>, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    remove_profile_in(&dir, &id, &db_file, &active()?.0)?;
    let pins = pin::update_pins(&dir, |f| f.profiles.remove(&id).is_some()).await.err();
    // id já validado acima; entry_for só aceita o item do perfil ativo
    let entry = keyring::Entry::new(SECRET_SERVICE, &vault_key(&id)).map_err(|e| e.to_string());
    Ok(entry.and_then(|e| delete_with(&e)).err().or(pins))
}

const SECRET_SERVICE: &str = "com.yagoramires.yield";
// Itens antigos da Pluggy (até a 0.3), lidos uma vez para migrar para o item único do perfil de hoje.
const OLD_PLUGGY_KEYS: [&str; 2] = ["pluggy.clientId", "pluggy.clientSecret"];

/// Um item por perfil guarda todas as credenciais dele; o de hoje continua no "yield.credentials".
fn vault_key(id: &str) -> String {
    if id == LEGACY_ID { "yield.credentials".into() } else { format!("yield.credentials.{id}") }
}

/// O perfil aberto só alcança o próprio item (e os antigos da Pluggy, que só o de hoje lê para migrar).
fn allowed_key(key: &str, active_id: &str) -> bool {
    OLD_PLUGGY_KEYS.contains(&key) || key == vault_key(active_id)
}

fn entry_for(key: &str) -> Result<keyring::Entry, String> {
    if !allowed_key(key, &active()?.0) {
        return Err("chave de credencial desconhecida".into());
    }
    keyring::Entry::new(SECRET_SERVICE, key).map_err(|e| e.to_string())
}

fn get_with(entry: &keyring::Entry) -> Result<Option<String>, String> {
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn set_with(entry: &keyring::Entry, value: &str) -> Result<(), String> {
    entry.set_password(value).map_err(|e| e.to_string())
}

fn delete_with(entry: &keyring::Entry) -> Result<(), String> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// As credenciais nunca vão para o webview: ele só sabe se existem e pede as duas chamadas que precisam delas.
#[derive(serde::Serialize, serde::Deserialize, Default, Clone, PartialEq, Debug)]
struct Vault {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pluggy: Option<PluggyCreds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    binance: Option<BinanceCreds>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
struct PluggyCreds {
    client_id: String,
    client_secret: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
struct BinanceCreds {
    api_key: String,
    secret: String,
}

// Item do cofre de perfil com PIN: "pin1:" + hex(nonce (12) || AES-256-GCM(json)), chave = a parte do cofre do Argon2id do PIN.
const VAULT_SEALED: &str = "pin1:";

fn seal_vault(json: &str, key: &db::Key) -> Result<String, String> {
    use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
    let nonce = aes_gcm::Aes256Gcm::generate_nonce(&mut OsRng);
    let cipher = aes_gcm::Aes256Gcm::new(key.into());
    let body = cipher.encrypt(&nonce, json.as_bytes()).map_err(|_| "Não foi possível criptografar as credenciais.".to_string())?;
    Ok(format!("{VAULT_SEALED}{}", pin::hex(&[nonce.as_slice(), &body].concat())))
}

/// Item sem o prefixo é de antes do PIN (ilegível vale como vazio); cifrado, só abre com a chave certa e nunca vira vazio.
fn open_vault(raw: &str, key: Option<&db::Key>) -> Result<Vault, String> {
    use aes_gcm::aead::{Aead, KeyInit};
    let Some(sealed) = raw.strip_prefix(VAULT_SEALED) else {
        return Ok(serde_json::from_str(raw).unwrap_or_default());
    };
    let key = key.ok_or(pin::LOCKED)?;
    let bad = || "Não foi possível abrir as credenciais deste perfil com o PIN.".to_string();
    let data = pin::unhex(sealed).filter(|d| d.len() > 12).ok_or_else(bad)?;
    let (nonce, body) = data.split_at(12);
    let json = aes_gcm::Aes256Gcm::new(key.into()).decrypt(nonce.into(), body).map_err(|_| bad())?;
    serde_json::from_slice(&json).map_err(|_| bad())
}

/// Grava o item: cifrado quando há chave (perfil com PIN desbloqueado), em claro como antes quando não.
fn store_vault(entry: &keyring::Entry, v: &Vault, key: Option<&db::Key>) -> Result<(), String> {
    let json = serde_json::to_string(v).map_err(|e| e.to_string())?;
    set_with(entry, &match key {
        Some(k) => seal_vault(&json, k)?,
        None => json,
    })
}

/// Regrava o item do perfil ativo de `from` para `to` e atualiza o cache; sem item, só migra os antigos da Pluggy (já com `to`).
fn reseal_vault(from: Option<&db::Key>, to: Option<&db::Key>) -> Result<(), String> {
    let mut cache = VAULT.lock().map_err(|e| e.to_string())?;
    let entry = entry_for(&vault_key(&active()?.0))?;
    let v = match get_with(&entry)? {
        Some(raw) => {
            let v = open_vault(&raw, from)?;
            store_vault(&entry, &v, to)?;
            v
        }
        None => read_vault(to)?,
    };
    *cache = Some(v);
    Ok(())
}

// Cada leitura do Keychain pode abrir o pedido de senha do macOS: lê uma vez por sessão (só guarda se der certo).
// É do perfil ativo: `profile_activate` zera.
static VAULT: std::sync::Mutex<Option<Vault>> = std::sync::Mutex::new(None);

fn load_vault() -> Result<Vault, String> {
    load_cached(&mut *VAULT.lock().map_err(|e| e.to_string())?)
}

/// Lê o cofre do perfil ativo; quem chama segura a trava do `VAULT`, então o perfil não muda no meio.
fn load_cached(cache: &mut Option<Vault>) -> Result<Vault, String> {
    if let Some(v) = cache.as_ref() {
        return Ok(v.clone());
    }
    let v = read_vault(pin::vault_key_for(&active()?.0).as_ref())?;
    *cache = Some(v.clone());
    Ok(v)
}

/// Lê o item do perfil ativo com `key` (a do PIN desbloqueado, ou nenhuma).
fn read_vault(key: Option<&db::Key>) -> Result<Vault, String> {
    let profile = active()?.0;
    let entry = entry_for(&vault_key(&profile))?;
    Ok(match get_with(&entry)? {
        // item ilegível não serve para nada: vale como vazio, e o próximo "Salvar" o sobrescreve
        Some(raw) => {
            let v = open_vault(&raw, key)?;
            // em claro num perfil desbloqueado: sobra de um crash no meio de ligar ou trocar o PIN
            if key.is_some() && !raw.starts_with(VAULT_SEALED) && v != Vault::default() {
                store_vault(&entry, &v, key)?;
            }
            v
        }
        // versões até a 0.3: um item por credencial da Pluggy. Passa para o item único e apaga os antigos.
        None if profile == LEGACY_ID => {
            let (id, secret) = (entry_for(OLD_PLUGGY_KEYS[0])?, entry_for(OLD_PLUGGY_KEYS[1])?);
            match (get_with(&id)?, get_with(&secret)?) {
                (Some(client_id), Some(client_secret)) => {
                    let v = Vault { pluggy: Some(PluggyCreds { client_id, client_secret }), binance: None };
                    store_vault(&entry, &v, key)?;
                    delete_with(&id)?;
                    delete_with(&secret)?;
                    v
                }
                _ => Vault::default(),
            }
        }
        None => Vault::default(),
    })
}

fn update_vault(change: impl FnOnce(&mut Vault)) -> Result<(), String> {
    let mut cache = VAULT.lock().map_err(|e| e.to_string())?;
    let mut v = load_cached(&mut cache)?;
    change(&mut v);
    let profile = active()?.0;
    let entry = entry_for(&vault_key(&profile))?;
    if v == Vault::default() {
        delete_with(&entry)?;
    } else {
        store_vault(&entry, &v, pin::vault_key_for(&profile).as_ref())?;
    }
    *cache = Some(v);
    Ok(())
}

fn filled(values: &[&str]) -> Result<(), String> {
    if values.iter().any(|v| v.trim().is_empty()) {
        return Err("Preencha os dois campos.".into());
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct VaultStatus {
    pluggy: bool,
    binance: bool,
}

#[tauri::command]
fn vault_status() -> Result<VaultStatus, String> {
    let v = load_vault()?;
    Ok(VaultStatus { pluggy: v.pluggy.is_some(), binance: v.binance.is_some() })
}

#[tauri::command]
fn vault_set_pluggy(client_id: String, client_secret: String) -> Result<(), String> {
    filled(&[&client_id, &client_secret])?;
    let creds = PluggyCreds { client_id: client_id.trim().into(), client_secret: client_secret.trim().into() };
    update_vault(|v| v.pluggy = Some(creds))
}

#[tauri::command]
fn vault_set_binance(api_key: String, secret: String) -> Result<(), String> {
    filled(&[&api_key, &secret])?;
    let creds = BinanceCreds { api_key: api_key.trim().into(), secret: secret.trim().into() };
    update_vault(|v| v.binance = Some(creds))
}

#[tauri::command]
fn vault_clear(part: String) -> Result<(), String> {
    match part.as_str() {
        "pluggy" => update_vault(|v| v.pluggy = None),
        "binance" => update_vault(|v| v.binance = None),
        _ => Err("credencial desconhecida".into()),
    }
}

/// Resposta crua da API para o webview tratar status e corpo como faria com um fetch.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpReply {
    status: u16,
    body: String,
    retry_after: Option<String>,
}

type Reqwest = tauri_plugin_http::reqwest::Client;
static HTTP: std::sync::OnceLock<Reqwest> = std::sync::OnceLock::new();

/// Um cliente só: o histórico da Binance são centenas de chamadas e reaproveita conexão e TLS.
fn http() -> Result<&'static Reqwest, String> {
    if let Some(c) = HTTP.get() {
        return Ok(c);
    }
    let c = Reqwest::builder().timeout(std::time::Duration::from_secs(30)).build().map_err(|e| e.to_string())?;
    Ok(HTTP.get_or_init(|| c))
}

/// Erro de rede vira este código; os outros erros (cofre, chave ausente, chamada recusada) chegam com a mensagem real.
const NET_ERROR: &str = "rede";

async fn send(req: tauri_plugin_http::reqwest::RequestBuilder) -> Result<HttpReply, String> {
    let res = req.send().await.map_err(|_| NET_ERROR.to_string())?;
    let status = res.status().as_u16();
    let retry_after = res.headers().get("retry-after").and_then(|v| v.to_str().ok()).map(str::to_owned);
    let body = res.text().await.map_err(|_| NET_ERROR.to_string())?;
    Ok(HttpReply { status, body, retry_after })
}

async fn vault_async() -> Result<Vault, String> {
    tauri::async_runtime::spawn_blocking(load_vault).await.map_err(|e| e.to_string())?
}

/// POST /auth da Pluggy com o Client ID e o Client Secret; o webview recebe só a apiKey (dura 2h).
#[tauri::command]
async fn pluggy_auth() -> Result<HttpReply, String> {
    let creds = vault_async().await?.pluggy.ok_or("Sem credenciais da Pluggy: configure em Configurações › Open Finance.")?;
    let body = serde_json::to_string(&creds).map_err(|e| e.to_string())?;
    send(http()?.post("https://api.pluggy.ai/auth").header("Content-Type", "application/json").body(body)).await
}

const BINANCE_READS: [&str; 6] = [
    "/api/v3/account",
    "/sapi/v1/simple-earn/flexible/position",
    "/sapi/v1/simple-earn/locked/position",
    "/sapi/v1/fiat/payments",
    "/sapi/v1/convert/tradeFlow",
    "/api/v3/myTrades",
];

fn hmac_hex(secret: &str, msg: &str) -> String {
    use hmac::Mac;
    let mut mac = hmac::Hmac::<sha2::Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC aceita chave de qualquer tamanho");
    mac.update(msg.as_bytes());
    mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect()
}

/// Caminho e consulta vêm do webview: só as leituras da lista e só parâmetros simples, senão a assinatura vira um oráculo.
fn binance_url(path: &str, query: &str, secret: &str) -> Result<String, String> {
    let simple = query.bytes().all(|b| b.is_ascii_alphanumeric() || b"=&-_.".contains(&b));
    if !BINANCE_READS.contains(&path) || !simple || query.contains("signature=") {
        return Err("Chamada não permitida: o Yield só lê dados da Binance".into());
    }
    Ok(format!("https://api.binance.com{path}?{query}&signature={}", hmac_hex(secret, query)))
}

/// GET assinado da Binance: a secret fica aqui; o webview manda o caminho e a consulta e recebe a resposta.
#[tauri::command]
async fn binance_get(path: String, query: String) -> Result<HttpReply, String> {
    let creds = vault_async().await?.binance.ok_or("Sem chave da Binance: configure em Configurações › Binance.")?;
    let url = binance_url(&path, &query, &creds.secret)?;
    send(http()?.get(url).header("X-MBX-APIKEY", creds.api_key)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Menu da barra do macOS em português, com "Procurar atualizações…" (o front escuta o evento e mostra o resultado).
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu_pt).on_menu_event(|app, event| {
        if event.id() == "check-updates" {
            let _ = app.emit("menu-check-updates", ());
        }
    });
    builder
        // banco sem senha de uma importação ou exportação interrompida (app fechado no meio) não fica no disco
        .setup(|app| {
            if let Ok(dir) = app.path().app_config_dir() {
                let _ = discard_restore_in(&dir);
                db::cleanup_pin_tmp(&dir);
                let _ = tauri::async_runtime::block_on(pin::forget_plain_pins(&dir));
            }
            if let Ok(dir) = app.path().app_data_dir() {
                for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
                    if is_export_tmp(&dir, &entry.path()) {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ai::State::default())
        // todo banco de perfil (o `yield.db` também) é migrado no JS pelo `meta.schema_version`
        .manage(db::Dbs::default())
        .invoke_handler(tauri::generate_handler![
            swap_database, encrypt_backup, is_encrypted_backup, backup_open, discard_restore, vault_status, vault_set_pluggy, vault_set_binance, vault_clear, pluggy_auth, binance_get,
            profiles_read, profiles_write, profile_activate, profile_remove_files,
            db::db_load, db::db_select, db::db_execute, db::db_close, db::profile_lock,
            pin::pin_supported, pin::profiles_locks, pin::profile_unlocked, pin::profile_unlock, pin::profile_set_pin, pin::profile_change_pin, pin::profile_remove_pin,
            ai::ai_hardware, ai::ai_installed, ai::ai_download, ai::ai_cancel_download, ai::ai_download_status, ai::ai_delete_model, ai::ai_start, ai::ai_stop, ai::ai_abort, ai::ai_post
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                ai::shutdown(app); // o modelo ocupa gigas de memória: não fica rodando depois que o app fecha
                tauri::async_runtime::block_on(db::close_all(&app.state::<db::Dbs>())); // como o plugin SQL fazia ao sair
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_com_senha_volta_so_com_a_senha_certa() {
        let sealed = seal(b"SQLite format 3 ...", "senha boa").unwrap();
        assert!(sealed.starts_with(BACKUP_MAGIC));
        assert!(!sealed.windows(6).any(|w| w == b"SQLite"));
        assert_eq!(unseal(&sealed, "senha boa").unwrap(), b"SQLite format 3 ...");
        assert_eq!(unseal(&sealed, "senha ruim").unwrap_err(), "Senha errada ou arquivo corrompido.");
        let mut bad = sealed.clone();
        *bad.last_mut().unwrap() ^= 1;
        assert!(unseal(&bad, "senha boa").is_err());
        assert_eq!(unseal(b"SQLite format 3", "x").unwrap_err(), "Este arquivo não é um backup do Yield com senha.");
        assert_ne!(seal(b"a", "s").unwrap(), seal(b"a", "s").unwrap()); // sal e nonce novos a cada vez
    }

    #[test]
    fn swap_troca_o_banco_e_guarda_copia_de_seguranca() {
        let dir = std::env::temp_dir().join(format!("yield-swap-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("yield.db"), "antigo").unwrap();
        std::fs::write(dir.join("yield.db-wal"), "wal").unwrap();
        std::fs::write(dir.join("yield.db-shm"), "shm").unwrap();
        let origem = dir.join("origem.db");
        std::fs::write(&origem, "novo").unwrap();

        let backup = swap_in_dir(&dir, &origem, "yield.db").unwrap();

        assert!(is_safety_copy_of(backup.file_name().unwrap().to_str().unwrap(), "yield.db"));
        assert!(backup.file_name().unwrap().to_str().unwrap().starts_with("seguranca-yield-"));
        assert_eq!(std::fs::read_to_string(dir.join("yield.db")).unwrap(), "novo");
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), "antigo");
        assert_eq!(std::fs::read_to_string(backup.with_extension("db-wal")).unwrap(), "wal");
        assert!(!dir.join("yield.db-wal").exists() && !dir.join("yield.db-shm").exists());
        assert!(!dir.join("yield.db.novo").exists());

        // restaurar em outro perfil troca só o banco dele
        std::fs::write(dir.join("perfil-abcd1234.db"), "do perfil").unwrap();
        std::fs::write(dir.join("perfil-abcd1234.db-wal"), "wal do perfil").unwrap();
        std::fs::write(&origem, "restaurado").unwrap();
        let do_perfil = swap_in_dir(&dir, &origem, "perfil-abcd1234.db").unwrap();
        assert!(do_perfil.file_name().unwrap().to_str().unwrap().starts_with("seguranca-perfil-abcd1234-"));
        assert_eq!(std::fs::read_to_string(&do_perfil).unwrap(), "do perfil");
        assert_eq!(std::fs::read_to_string(do_perfil.with_extension("db-wal")).unwrap(), "wal do perfil");
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), "antigo"); // no mesmo segundo, uma não sobrescreve a outra
        assert_eq!(std::fs::read_to_string(dir.join("perfil-abcd1234.db")).unwrap(), "restaurado");
        assert!(!dir.join("perfil-abcd1234.db-wal").exists() && !dir.join("perfil-abcd1234.db.novo").exists());
        assert_eq!(std::fs::read_to_string(dir.join("yield.db")).unwrap(), "novo");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("yield-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn perfil_so_aceita_o_proprio_arquivo() {
        assert!(valid_profile("principal", "yield.db"));
        assert!(valid_profile("abcd1234", "perfil-abcd1234.db"));
        assert!(!valid_profile("abcd1234", "yield.db"));
        assert!(!valid_profile("abcd1234", "perfil-outro999.db"));
        assert!(!valid_profile("abcd1234", "../perfil-abcd1234.db"));
        assert!(!valid_profile("../x", "perfil-../x.db"));
        assert!(!valid_profile("principal", "perfil-principal.db"));
        // mesmas regras do profiles.ts: 8 a 40 de [a-z0-9]
        assert!(valid_profile(&"a".repeat(40), &format!("perfil-{}.db", "a".repeat(40))));
        assert!(!valid_profile(&"a".repeat(41), &format!("perfil-{}.db", "a".repeat(41))));
        assert!(!valid_profile("abcd123", "perfil-abcd123.db"));
        assert!(!valid_profile("ABCD1234", "perfil-ABCD1234.db"));
        assert!(!valid_profile("", "perfil-.db"));
    }

    #[test]
    fn cofre_do_perfil_de_hoje_e_o_item_antigo() {
        assert_eq!(vault_key("principal"), "yield.credentials");
        assert_eq!(vault_key("abcd1234"), "yield.credentials.abcd1234");
    }

    #[test]
    fn gravacao_atomica_nao_deixa_temporario() {
        let dir = tmp("perfis-atomico");
        let f = dir.join("perfis.json");
        write_atomic(&f, "{\"version\":1}").unwrap();
        write_atomic(&f, "{\"version\":1,\"profiles\":[]}").unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "{\"version\":1,\"profiles\":[]}");
        assert!(!dir.join("perfis.json.tmp").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn remover_perfil_apaga_so_os_arquivos_dele() {
        let dir = tmp("perfis-remover");
        let do_perfil = ["perfil-abcd1234.db", "perfil-abcd1234.db-wal", "perfil-abcd1234.db-shm", "perfil-abcd1234.db.pin-tmp", "perfil-abcd1234.db.salt"];
        for f in do_perfil.iter().chain(&["yield.db", "yield.db-wal"]) {
            std::fs::write(dir.join(f), "x").unwrap();
        }
        assert!(remove_profile_in(&dir, "abcd1234", "perfil-abcd1234.db", "abcd1234").is_err());
        assert!(remove_profile_in(&dir, "abcd1234", "yield.db", "principal").is_err());
        assert!(remove_profile_in(&dir, "../x", "perfil-../x.db", "principal").is_err());
        assert!(dir.join("perfil-abcd1234.db").exists());
        remove_profile_in(&dir, "abcd1234", "perfil-abcd1234.db", "principal").unwrap();
        assert!(do_perfil.iter().all(|f| !dir.join(f).exists()));
        assert!(dir.join("yield.db").exists() && dir.join("yield.db-wal").exists());
        // de novo, sem arquivos: não é erro
        remove_profile_in(&dir, "abcd1234", "perfil-abcd1234.db", "principal").unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn remover_perfil_apaga_as_copias_de_seguranca_dele() {
        let dir = tmp("perfis-copias");
        let do_perfil = ["seguranca-perfil-abcd1234-1793000000.db", "seguranca-perfil-abcd1234-1793000000.db-wal"];
        let do_principal = ["seguranca-yield-1793000000.db", "seguranca-yield-1793000000.db-wal", "seguranca-1700000000.db", "seguranca-1700000000.db-wal"];
        let ficam = ["seguranca-perfil-abcd12345-1793000000.db", "seguranca-perfil-zzzz9999-1793000000.db", "seguranca-yield-x.db", "seguranca-perfil-abcd1234-1793.txt", "perfis.json"];
        for f in do_perfil.iter().chain(&do_principal).chain(&ficam) {
            std::fs::write(dir.join(f), "x").unwrap();
        }
        remove_profile_in(&dir, "abcd1234", "perfil-abcd1234.db", "principal").unwrap();
        assert!(do_perfil.iter().all(|f| !dir.join(f).exists()));
        assert!(do_principal.iter().chain(&ficam).all(|f| dir.join(f).exists()));
        // o `principal` leva também as cópias sem stem das versões antigas, que eram todas dele
        remove_profile_in(&dir, "principal", "yield.db", "abcd1234").unwrap();
        assert!(do_principal.iter().all(|f| !dir.join(f).exists()));
        assert!(ficam.iter().all(|f| dir.join(f).exists()));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn perfis_ilegivel_ganha_copia_antes_de_ser_regravado() {
        let dir = tmp("perfis-ilegivel");
        assert_eq!(read_profiles_in(&dir).unwrap(), None);
        let copias = |d: &Path| std::fs::read_dir(d).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with("perfis.json.ilegivel-")).map(|e| e.path()).collect::<Vec<_>>();
        std::fs::write(dir.join("perfis.json"), "{\"version\":1,\"profiles\":[]}").unwrap();
        read_profiles_in(&dir).unwrap();
        std::fs::write(dir.join("perfis.json"), "").unwrap();
        read_profiles_in(&dir).unwrap();
        assert!(copias(&dir).is_empty());
        std::fs::write(dir.join("perfis.json"), "{\"profiles\":[{\"id\":\"abcd1234\"").unwrap();
        assert_eq!(read_profiles_in(&dir).unwrap().as_deref(), Some("{\"profiles\":[{\"id\":\"abcd1234\""));
        let c = copias(&dir);
        assert_eq!(c.len(), 1);
        assert_eq!(std::fs::read_to_string(&c[0]).unwrap(), "{\"profiles\":[{\"id\":\"abcd1234\"");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn caminhos_do_webview_sao_conferidos() {
        let dir = std::env::temp_dir().join(format!("yield-paths-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let tmp = dir.join("export-1.db");
        let novo = dir.join("novo.yield");
        assert!(check_export(&dir, &tmp, &novo).is_ok());
        // origem fora da pasta do app, com outro nome ou escapando com ..
        assert!(check_export(&dir, Path::new("/etc/hosts"), &novo).is_err());
        assert!(check_export(&dir, &dir.join("yield.db"), &novo).is_err());
        assert!(check_export(&dir, &dir.join("sub").join("..").join("export-1.db"), &novo).is_err());
        assert!(check_export(&dir, &tmp, &dir.join("Novo.YIELD")).is_ok());
        // destino: só .yield, e só sobrescreve outro backup com senha; recusado, o temporário sem senha some
        std::fs::write(&tmp, "banco").unwrap();
        assert!(check_export(&dir, &tmp, &dir.join("x.txt")).is_err());
        assert!(!tmp.exists());
        let outro = dir.join("documento.yield");
        std::fs::write(&outro, "não é backup").unwrap();
        assert!(check_export(&dir, &tmp, &outro).is_err());
        std::fs::write(&outro, seal(b"x", "s").unwrap()).unwrap();
        assert!(check_export(&dir, &tmp, &outro).is_ok());
        assert!(!check_export(&dir, Path::new("/etc/hosts"), &dir.join("x.txt")).is_ok() && Path::new("/etc/hosts").exists());
        // swap só aceita SQLite
        std::fs::write(&tmp, b"SQLite format 3\0resto").unwrap();
        assert!(starts_with(&tmp, SQLITE_MAGIC).unwrap());
        assert!(!starts_with(&outro, SQLITE_MAGIC).unwrap());
        // restore.db some; apagar de novo não é erro
        std::fs::write(dir.join(RESTORE_FILE), "banco aberto").unwrap();
        discard_restore_in(&dir).unwrap();
        assert!(!dir.join(RESTORE_FILE).exists());
        discard_restore_in(&dir).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn backup_escolhido_vira_restore_db() {
        let dir = tmp("backup-open");
        let antigo = dir.join("antigo.db");
        std::fs::write(&antigo, b"SQLite format 3\0antigo").unwrap();
        backup_open_in(&dir, &antigo, None).unwrap();
        assert_eq!(std::fs::read(dir.join(RESTORE_FILE)).unwrap(), b"SQLite format 3\0antigo");
        let com_senha = dir.join("b.yield");
        std::fs::write(&com_senha, seal(b"SQLite format 3\0com senha", "s").unwrap()).unwrap();
        backup_open_in(&dir, &com_senha, Some("s")).unwrap();
        assert_eq!(std::fs::read(dir.join(RESTORE_FILE)).unwrap(), b"SQLite format 3\0com senha");
        assert_eq!(backup_open_in(&dir, &com_senha, Some("x")).unwrap_err(), "Senha errada ou arquivo corrompido.");
        assert_eq!(backup_open_in(&dir, &com_senha, None).unwrap_err(), "Este arquivo não é um backup do Yield.");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn perfil_aberto_so_alcanca_o_proprio_item_do_cofre() {
        assert!(!allowed_key("yield.credentials", "abcd1234"));
        assert!(allowed_key("yield.credentials.abcd1234", "abcd1234"));
        assert!(!allowed_key("yield.credentials.zzzz9999", "abcd1234"));
        assert!(allowed_key("yield.credentials", "principal"));
        assert!(!allowed_key("yield.credentials.abcd1234", "principal"));
    }

    #[test]
    fn cofre_rejeita_key_desconhecida_antes_de_tocar_no_cofre() {
        let _g = pin::testutil::globals(); // depende do perfil ativo ser o `principal`
        assert!(entry_for("outra.coisa").is_err());
        assert!(entry_for("pluggy.clientId").is_ok());
        assert!(entry_for("yield.credentials").is_ok());
    }

    #[test]
    fn binance_assina_igual_a_documentacao_e_so_le_da_lista() {
        let q = "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
        let secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
        assert_eq!(hmac_hex(secret, q), "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
        let url = binance_url("/api/v3/account", "timestamp=1&recvWindow=10000", secret).unwrap();
        assert!(url.starts_with("https://api.binance.com/api/v3/account?timestamp=1&recvWindow=10000&signature="));
        assert!(!url.contains(secret));
        assert!(binance_url("/sapi/v1/capital/withdraw/apply", "timestamp=1", secret).is_err());
        assert!(binance_url("/api/v3/order", "timestamp=1", secret).is_err());
        assert!(binance_url("/api/v3/account/../order", "timestamp=1", secret).is_err());
        for q in ["a=1#x", "a=1 b", "a=%2F", "a=1&signature=x", "@evil.example/"] {
            assert!(binance_url("/api/v3/account", q, secret).is_err(), "{q}");
        }
    }

    #[tokio::test]
    async fn pool_aberto_nao_dispensa_o_pin_depois_da_troca() {
        let _g = pin::testutil::globals();
        let dir = pin::testutil::cifrado("yield.db", "1234").await;
        let dbs = db::Dbs::default();
        let keys = pin::derive("1234", &pin::testutil::SALT).unwrap();
        *pin::UNLOCKED.lock().unwrap() = Some((LEGACY_ID.into(), keys));
        activate_in(&dbs, LEGACY_ID.into(), LEGACY_DB.into()).await.unwrap();
        db::load_in(&dbs, &dir, LEGACY_DB).await.unwrap();
        db::load_in(&dbs, &dir, LEGACY_DB).await.unwrap(); // StrictMode: o segundo não reabre
        let keys = pin::UNLOCKED.lock().unwrap().take();
        assert!(db::load_in(&dbs, &dir, LEGACY_DB).await.is_err()); // pool aberto não dispensa a chave
        *pin::UNLOCKED.lock().unwrap() = keys;
        activate_in(&dbs, "abcd1234".into(), "perfil-abcd1234.db".into()).await.unwrap();
        assert!(dbs.0.lock().await.is_empty()); // a troca fecha o pool do outro perfil
        activate_in(&dbs, LEGACY_ID.into(), LEGACY_DB.into()).await.unwrap();
        assert_eq!(db::load_in(&dbs, &dir, LEGACY_DB).await.unwrap_err(), "Perfil bloqueado: digite o PIN.");
        assert!(dbs.0.lock().await.is_empty());
        *ACTIVE.lock().unwrap() = None;
    }

    #[test]
    fn cofre_le_o_formato_gravado_pelas_versoes_anteriores() {
        let v: Vault = serde_json::from_str(r#"{"pluggy":{"clientId":"id","clientSecret":"s"}}"#).unwrap();
        assert_eq!(v.pluggy, Some(PluggyCreds { client_id: "id".into(), client_secret: "s".into() }));
        assert_eq!(v.binance, None);
        let full = Vault { binance: Some(BinanceCreds { api_key: "k".into(), secret: "z".into() }), ..v };
        assert_eq!(serde_json::to_string(&full).unwrap(), r#"{"pluggy":{"clientId":"id","clientSecret":"s"},"binance":{"apiKey":"k","secret":"z"}}"#);
        assert!(filled(&["a", " "]).is_err() && filled(&["a", "b"]).is_ok());
        assert_eq!(serde_json::from_str::<Vault>("{").unwrap_or_default(), Vault::default());
        // o corpo do /auth é o que a Pluggy espera
        assert_eq!(serde_json::to_string(&full.pluggy.unwrap()).unwrap(), r#"{"clientId":"id","clientSecret":"s"}"#);
    }

    #[test]
    fn cofre_cifrado_so_abre_com_a_chave_do_pin() {
        let (k, outra) = ([7u8; 32], [8u8; 32]);
        let raw = seal_vault(r#"{"pluggy":{"clientId":"id","clientSecret":"segredo"}}"#, &k).unwrap();
        assert!(raw.starts_with("pin1:") && !raw.contains("segredo") && !raw.contains("clientSecret"));
        assert_eq!(open_vault(&raw, Some(&k)).unwrap().pluggy.unwrap().client_secret, "segredo");
        assert!(open_vault(&raw, None).is_err() && open_vault(&raw, Some(&outra)).is_err());
        assert!(open_vault(r#"{"binance":{"apiKey":"a","secret":"b"}}"#, None).unwrap().binance.is_some()); // item de antes do PIN
        assert!(open_vault("pin1:zz", Some(&k)).is_err() && open_vault("pin1:", Some(&k)).is_err());
    }

    #[test]
    fn cofre_set_get_delete() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        let e = entry_for("pluggy.clientSecret").unwrap();
        assert_eq!(get_with(&e).unwrap(), None);
        set_with(&e, "valor").unwrap();
        assert_eq!(get_with(&e).unwrap(), Some("valor".to_string()));
        delete_with(&e).unwrap();
        assert_eq!(get_with(&e).unwrap(), None);
        delete_with(&e).unwrap();
    }
}
