#[cfg(target_os = "macos")]
use tauri::Emitter;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

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
    let backup = swap_in_dir(&dir, source)?;
    if source == dir.join(RESTORE_FILE) {
        let _ = std::fs::remove_file(source); // cópia aberta do backup com senha: já está no banco
    }
    Ok(backup.to_string_lossy().into_owned())
}

#[tauri::command]
fn move_file(from: String, to: String) -> Result<(), String> {
    if std::fs::rename(&from, &to).is_ok() {
        return Ok(());
    }
    // rename falha entre volumes: copia e remove a origem
    std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
    std::fs::remove_file(&from).map_err(|e| e.to_string())
}

// Backup com senha: "YIELDBK1" + sal (16) + nonce (12) + AES-256-GCM(banco), chave = Argon2id(senha, sal).
const BACKUP_MAGIC: &[u8; 8] = b"YIELDBK1";

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

/// Criptografa o banco exportado (`from`, temporário) em `to` e apaga o temporário.
#[tauri::command]
fn encrypt_backup(from: String, to: String, password: String) -> Result<(), String> {
    let plain = std::fs::read(&from).map_err(|e| e.to_string())?;
    let sealed = seal(&plain, &password);
    std::fs::remove_file(&from).map_err(|e| e.to_string())?;
    std::fs::write(&to, sealed?).map_err(|e| e.to_string())
}

#[tauri::command]
fn is_encrypted_backup(path: String) -> Result<bool, String> {
    use std::io::Read;
    let mut head = [0u8; 8];
    let n = std::fs::File::open(&path).and_then(|mut f| f.read(&mut head)).map_err(|e| e.to_string())?;
    Ok(n == 8 && &head == BACKUP_MAGIC)
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

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    get_with(&entry_for(&key)?)
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    set_with(&entry_for(&key)?, &value)
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    delete_with(&entry_for(&key)?)
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
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:yield.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![swap_database, move_file, encrypt_backup, is_encrypted_backup, decrypt_backup, secret_get, secret_set, secret_delete])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
    fn cofre_rejeita_key_desconhecida_antes_de_tocar_no_cofre() {
        assert!(entry_for("outra.coisa").is_err());
        assert!(entry_for("pluggy.clientId").is_ok());
        assert!(entry_for("yield.credentials").is_ok());
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
