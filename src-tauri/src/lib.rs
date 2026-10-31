#[cfg(target_os = "macos")]
use tauri::Emitter;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

mod ai;

/// Troca `yield.db` em `dir` pelo conteúdo de `source`; devolve o caminho da cópia de segurança.
fn swap_in_dir(dir: &Path, source: &Path) -> Result<PathBuf, String> {
    let err = |e: std::io::Error| e.to_string();
    let db = dir.join("yield.db");
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
    let backup = dir.join(format!("seguranca-{secs}.db"));
    std::fs::copy(&db, &backup).map_err(err)?;
    // WAL não checkpointado: preserva ao lado da cópia para não perder transações recentes
    let wal = dir.join("yield.db-wal");
    if wal.exists() {
        std::fs::copy(&wal, dir.join(format!("seguranca-{secs}.db-wal"))).map_err(err)?;
    }
    let tmp = dir.join("yield.db.novo");
    std::fs::copy(source, &tmp).map_err(err)?;
    for ext in ["yield.db-wal", "yield.db-shm"] {
        match std::fs::remove_file(dir.join(ext)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    std::fs::rename(&tmp, &db).map_err(err)?;
    Ok(backup)
}

#[tauri::command]
fn swap_database(app: tauri::AppHandle, source: String) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let source = Path::new(&source);
    // o caminho vem do webview: só aceita um banco SQLite
    if !starts_with(source, SQLITE_MAGIC)? {
        return Err("Este arquivo não é um backup do Yield.".into());
    }
    let backup = swap_in_dir(&dir, source)?;
    if source == dir.join(RESTORE_FILE) {
        let _ = std::fs::remove_file(source); // cópia aberta do backup com senha: já está no banco
    }
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

/// Descriptografa para `restore.db` na pasta do app; `swap_database` apaga esse arquivo depois de usar.
#[tauri::command]
fn decrypt_backup(app: tauri::AppHandle, from: String, password: String) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let plain = unseal(&std::fs::read(&from).map_err(|e| e.to_string())?, &password)?;
    let out = dir.join(RESTORE_FILE);
    std::fs::write(&out, plain).map_err(|e| e.to_string())?;
    Ok(out.to_string_lossy().into_owned())
}

const RESTORE_FILE: &str = "restore.db";

/// Apaga o `restore.db` (backup com senha já aberto, sem criptografia) quando a importação não vai até o fim.
fn discard_restore_in(dir: &Path) -> Result<(), String> {
    match std::fs::remove_file(dir.join(RESTORE_FILE)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
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

const SECRET_SERVICE: &str = "com.yagoramires.yield";
// "yield.credentials" guarda tudo num item só; os outros são os itens antigos, lidos uma vez para migrar.
const SECRET_KEYS: [&str; 3] = ["yield.credentials", "pluggy.clientId", "pluggy.clientSecret"];

fn entry_for(key: &str) -> Result<keyring::Entry, String> {
    if !SECRET_KEYS.contains(&key) {
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

// Cada leitura do Keychain pode abrir o pedido de senha do macOS: lê uma vez por sessão (só guarda se der certo).
static VAULT: std::sync::Mutex<Option<Vault>> = std::sync::Mutex::new(None);

fn load_vault() -> Result<Vault, String> {
    let mut cache = VAULT.lock().map_err(|e| e.to_string())?;
    if let Some(v) = cache.as_ref() {
        return Ok(v.clone());
    }
    let v = match get_with(&entry_for(SECRET_KEYS[0])?)? {
        // item ilegível não serve para nada: vale como vazio, e o próximo "Salvar" o sobrescreve
        Some(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        None => {
            // versões até a 0.3: um item por credencial da Pluggy. Passa para o item único e apaga os antigos.
            let (id, secret) = (entry_for(SECRET_KEYS[1])?, entry_for(SECRET_KEYS[2])?);
            match (get_with(&id)?, get_with(&secret)?) {
                (Some(client_id), Some(client_secret)) => {
                    let v = Vault { pluggy: Some(PluggyCreds { client_id, client_secret }), binance: None };
                    set_with(&entry_for(SECRET_KEYS[0])?, &serde_json::to_string(&v).map_err(|e| e.to_string())?)?;
                    delete_with(&id)?;
                    delete_with(&secret)?;
                    v
                }
                _ => Vault::default(),
            }
        }
    };
    *cache = Some(v.clone());
    Ok(v)
}

fn update_vault(change: impl FnOnce(&mut Vault)) -> Result<(), String> {
    let mut v = load_vault()?;
    change(&mut v);
    let entry = entry_for(SECRET_KEYS[0])?;
    if v == Vault::default() {
        delete_with(&entry)?;
    } else {
        set_with(&entry, &serde_json::to_string(&v).map_err(|e| e.to_string())?)?;
    }
    *VAULT.lock().map_err(|e| e.to_string())? = Some(v);
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
    let migrations = vec![
        Migration {
            version: 1,
            description: "init",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "gastos",
            sql: include_str!("../migrations/002_gastos.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "orcamento",
            sql: include_str!("../migrations/003_orcamento.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "fontes de renda",
            sql: include_str!("../migrations/004_fontes_renda.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "categoria da pluggy",
            sql: include_str!("../migrations/005_categoria_pluggy.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "visual das categorias",
            sql: include_str!("../migrations/006_categoria_visual.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "fonte de renda clt",
            sql: include_str!("../migrations/007_fonte_clt.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "cadastro da declaracao de ir",
            sql: include_str!("../migrations/008_cadastro_ir.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "renda fixa, exterior e cripto",
            sql: include_str!("../migrations/009_renda_fixa_cripto.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "aportado dos ativos manuais",
            sql: include_str!("../migrations/010_aportado_manual.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "etf de renda fixa",
            sql: include_str!("../migrations/011_etf_renda_fixa.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "aportado da cripto calculado ou a mao",
            sql: include_str!("../migrations/012_aportado_cripto.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "fonte de renda mei",
            sql: include_str!("../migrations/013_fonte_mei.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "blocos do orcamento",
            sql: include_str!("../migrations/014_orcamento_blocos.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "metas do orcamento",
            sql: include_str!("../migrations/015_metas.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "saldo das contas",
            sql: include_str!("../migrations/016_saldo_contas.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "investimentos do banco",
            sql: include_str!("../migrations/017_investimentos_banco.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "insights da ia",
            sql: include_str!("../migrations/018_ai_insights.sql"),
            kind: MigrationKind::Up,
        },
    ];
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
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:yield.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ai::State::default())
        .invoke_handler(tauri::generate_handler![
            swap_database, encrypt_backup, is_encrypted_backup, decrypt_backup, discard_restore, vault_status, vault_set_pluggy, vault_set_binance, vault_clear, pluggy_auth, binance_get,
            ai::ai_hardware, ai::ai_installed, ai::ai_download, ai::ai_cancel_download, ai::ai_download_status, ai::ai_delete_model, ai::ai_start, ai::ai_stop, ai::ai_abort, ai::ai_post
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                ai::shutdown(app); // o modelo ocupa gigas de memória: não fica rodando depois que o app fecha
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

        let backup = swap_in_dir(&dir, &origem).unwrap();

        assert_eq!(std::fs::read_to_string(dir.join("yield.db")).unwrap(), "novo");
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), "antigo");
        assert_eq!(std::fs::read_to_string(backup.with_extension("db-wal")).unwrap(), "wal");
        assert!(!dir.join("yield.db-wal").exists() && !dir.join("yield.db-shm").exists());
        assert!(!dir.join("yield.db.novo").exists());
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
    fn cofre_rejeita_key_desconhecida_antes_de_tocar_no_cofre() {
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
