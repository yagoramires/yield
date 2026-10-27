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
    swap_in_dir(&dir, Path::new(&source)).map(|p| p.to_string_lossy().into_owned())
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
    ];
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:yield.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![swap_database, move_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
