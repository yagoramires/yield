// Assistente com IA local: hardware, download do modelo e o llama-server em 127.0.0.1.
// A chave do servidor nunca sai daqui: o front fala com o modelo só por `ai_post`.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tauri_plugin_http::reqwest;

const IDLE_SECS: u64 = 600; // desliga após 10 min sem uso: o modelo médio ocupa ~6 GB
const NOT_ON: &str = "O Assistente não está ligado.";
const BAD_FILE: &str = "Nome de modelo inválido.";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub name: String,
    pub vram_mib: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    ram_bytes: u64,
    arch: String,
    os: String,
    gpu: Option<Gpu>,
}

#[derive(Serialize, Clone)]
pub struct Progress {
    received: u64,
    total: u64,
}

#[derive(Serialize)]
pub struct Installed {
    file: String,
    bytes: u64,
}

struct Server {
    child: Child,
    file: String,
    port: u16,
    key: String,
    #[cfg(windows)]
    _job: Option<Job>,
}

#[derive(Default)]
pub struct State {
    server: Mutex<Option<Server>>,
    hardware: Mutex<Option<Hardware>>,
    cancel_download: AtomicBool,
    downloading: AtomicBool,
    progress: Mutex<Option<Progress>>, // a tela lê daqui: sair e voltar (ou recarregar) não perde o download
    starting: tokio::sync::Mutex<()>, // um ai_start por vez: o segundo espera o primeiro ficar pronto
    abort_gen: AtomicU64,             // "Parar" vale para a requisição em andamento, não para a próxima
    last_use: AtomicU64,
    watchdog: AtomicBool,
}

/// Linha `Vulkan<n>: <nome> (<total> MiB, <livre> MiB free)` do `--list-devices`; fica a de mais memória.
#[cfg_attr(not(windows), allow(dead_code))] // só o Windows detecta GPU por aqui
pub(crate) fn parse_devices(out: &str) -> Option<Gpu> {
    out.lines()
        .filter_map(|l| {
            let rest = l.trim().strip_prefix("Vulkan")?.split_once(": ")?.1;
            let (name, inside) = rest.rsplit_once(" (")?;
            Some(Gpu { name: name.trim().into(), vram_mib: inside.split(' ').next()?.parse().ok()? })
        })
        .max_by_key(|g| g.vram_mib)
}

pub(crate) fn valid_model_file(name: &str) -> bool {
    name.len() > 5 && name.ends_with(".gguf") && !name.contains("..") && name.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

pub(crate) fn allowed_url(url: &str) -> bool {
    url.starts_with("https://huggingface.co/")
}

/// A chave vai por `LLAMA_API_KEY`, nunca aqui (a linha de comando aparece no `ps`). Sem `-ngl`: o padrão cabe na memória da GPU.
pub(crate) fn server_args(model: &Path, port: u16, ctx: u32) -> Vec<String> {
    let mut a: Vec<String> = vec!["-m".into(), model.to_string_lossy().into_owned()];
    for s in ["--host", "127.0.0.1", "--port", &port.to_string(), "-c", &ctx.to_string(), "-np", "1", "--jinja", "--reasoning-budget", "0", "--no-webui"] {
        a.push(s.into());
    }
    a
}

/// Devolve o começo UTF-8 completo de `buf` e deixa nele o caractere cortado no meio.
pub(crate) fn take_utf8(buf: &mut Vec<u8>) -> String {
    let n = match std::str::from_utf8(buf) {
        Ok(_) => buf.len(),
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        Err(_) => buf.len(), // byte inválido no meio: não trava, sai com �
    };
    let out = String::from_utf8_lossy(&buf[..n]).into_owned();
    buf.drain(..n);
    out
}

/// Marca de "um por vez": `begin` falha se já há outro em andamento; soltar (fim ou erro) libera.
pub(crate) struct Busy<'a>(&'a AtomicBool);
impl<'a> Busy<'a> {
    pub(crate) fn begin(flag: &'a AtomicBool) -> Option<Self> {
        (!flag.swap(true, Ordering::AcqRel)).then_some(Busy(flag))
    }
}
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn io_err(e: std::io::Error) -> String {
    format!("Não foi possível gravar o modelo: {e}")
}

/// Baixa para `<dest>.part` continuando de onde parou; confere o SHA-256 antes de virar `dest`.
pub(crate) async fn download_to(client: &reqwest::Client, url: &str, sha256: &str, size: u64, dest: &Path, cancel: &AtomicBool, mut progress: impl FnMut(u64, u64)) -> Result<(), String> {
    let part = dest.with_extension("gguf.part");
    let have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if have == size && size > 0 {
        progress(have, have); // já veio inteiro (o app fechou na conferência): só falta conferir
        return verify(&part, sha256, dest);
    }
    let mut req = client.get(url);
    if have > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let net = |e: reqwest::Error| format!("O download falhou: {e}");
    let mut resp = req.send().await.map_err(net)?;
    let status = resp.status();
    // 416: o .part já está completo, só falta conferir
    if status != reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        if !status.is_success() {
            return Err(format!("O download falhou (HTTP {}).", status.as_u16()));
        }
        let resumed = status == reqwest::StatusCode::PARTIAL_CONTENT;
        let mut file = if resumed { std::fs::OpenOptions::new().append(true).open(&part) } else { std::fs::File::create(&part) }.map_err(io_err)?;
        let mut received = if resumed { have } else { 0 };
        // sem Content-Length, o tamanho do catálogo: senão a tela acharia que acabou e mostraria "conferindo" o download todo
        let total = resp.content_length().filter(|l| *l > 0).map_or(size, |l| received + l);
        while let Some(chunk) = resp.chunk().await.map_err(net)? {
            if cancel.load(Ordering::Relaxed) {
                return Err("Download cancelado.".into());
            }
            file.write_all(&chunk).map_err(io_err)?;
            received += chunk.len() as u64;
            progress(received, total);
        }
    }
    verify(&part, sha256, dest)
}

/// Confere o SHA-256 do `.part` e só então vira o arquivo final; errado, apaga.
fn verify(part: &Path, sha256: &str, dest: &Path) -> Result<(), String> {
    let mut hasher = Sha256::new();
    std::io::copy(&mut std::fs::File::open(part).map_err(io_err)?, &mut hasher).map_err(io_err)?;
    if format!("{:x}", hasher.finalize()) != sha256.to_lowercase() {
        let _ = std::fs::remove_file(part);
        return Err("O arquivo baixado veio corrompido. Tente baixar de novo.".into());
    }
    std::fs::rename(part, dest).map_err(io_err)
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    // local, não roaming: no Windows a pasta roaming iria junto com o perfil (5 GB)
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("models");
    std::fs::create_dir_all(&dir).map_err(io_err)?;
    Ok(dir)
}

fn sidecar(name: &str) -> Result<PathBuf, String> {
    Ok(std::env::current_exe().map_err(|e| e.to_string())?.with_file_name(format!("{name}{}", std::env::consts::EXE_SUFFIX)))
}

fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: sem janela de console
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
}

#[cfg(target_os = "macos")]
fn ram_bytes() -> u64 {
    let mut v: u64 = 0;
    let mut len = std::mem::size_of::<u64>();
    unsafe { libc::sysctlbyname(c"hw.memsize".as_ptr(), &mut v as *mut u64 as *mut libc::c_void, &mut len, std::ptr::null_mut(), 0) };
    v
}

#[cfg(windows)]
fn ram_bytes() -> u64 {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut m: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    m.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    unsafe { GlobalMemoryStatusEx(&mut m) };
    m.ullTotalPhys
}

#[cfg(not(any(target_os = "macos", windows)))]
fn ram_bytes() -> u64 {
    0
}

/// GPU só importa no Windows (no Mac é a Metal). Sem `vulkan-1.dll` o sidecar Vulkan nem abre: fica o de CPU.
#[cfg(windows)]
fn detect_gpu() -> Option<Gpu> {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    if !Path::new(&root).join("System32").join("vulkan-1.dll").exists() {
        return None;
    }
    let mut cmd = Command::new(sidecar("llama-server").ok()?);
    hidden(&mut cmd).arg("--list-devices").stdout(Stdio::piped()).stderr(Stdio::piped());
    let out = cmd.output().ok()?;
    parse_devices(&format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
}

#[cfg(not(windows))]
fn detect_gpu() -> Option<Gpu> {
    None
}

fn hardware(st: &State) -> Hardware {
    st.hardware
        .lock()
        .unwrap()
        .get_or_insert_with(|| Hardware { ram_bytes: ram_bytes(), arch: std::env::consts::ARCH.into(), os: std::env::consts::OS.into(), gpu: detect_gpu() })
        .clone()
}

#[cfg(windows)]
struct Job(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
unsafe impl Send for Job {}
#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

/// O servidor morre junto com o app mesmo num crash: o Windows mata o job quando o último handle fecha.
#[cfg(windows)]
fn kill_on_close(child: &Child) -> Option<Job> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::*;
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return None;
        }
        let job = Job(job);
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
        if SetInformationJobObject(job.0, JobObjectExtendedLimitInformation, &info as *const _ as *const _, size) == 0 || AssignProcessToJobObject(job.0, child.as_raw_handle() as _) == 0 {
            return None;
        }
        Some(job)
    }
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn touch(st: &State) {
    st.last_use.store(now_secs(), Ordering::Relaxed);
}

fn kill(mut s: Server) {
    let _ = s.child.kill();
    let _ = s.child.wait();
}

fn stop(st: &State) {
    if let Some(s) = st.server.lock().unwrap().take() {
        kill(s);
    }
}

pub fn shutdown(app: &AppHandle) {
    stop(&app.state::<State>());
}

fn start_watchdog(app: &AppHandle) {
    if app.state::<State>().watchdog.swap(true, Ordering::Relaxed) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let st = app.state::<State>();
            if now_secs().saturating_sub(st.last_use.load(Ordering::Relaxed)) >= IDLE_SECS {
                stop(&st);
            }
        }
    });
}

fn local_client() -> Result<reqwest::Client, String> {
    // sem proxy: um proxy do sistema não pode ver os prompts com os dados financeiros
    reqwest::Client::builder().no_proxy().build().map_err(|e| e.to_string())
}

fn random_key() -> String {
    use aes_gcm::aead::{rand_core::RngCore, OsRng};
    let mut b = [0u8; 32];
    OsRng.fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[tauri::command]
pub async fn ai_hardware(app: AppHandle) -> Hardware {
    hardware(&app.state::<State>())
}

#[tauri::command]
pub fn ai_installed(app: AppHandle) -> Result<Vec<Installed>, String> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(models_dir(&app)?).map_err(io_err)?.flatten() {
        let file = e.file_name().to_string_lossy().into_owned();
        if valid_model_file(&file) {
            out.push(Installed { file, bytes: e.metadata().map(|m| m.len()).unwrap_or(0) });
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn ai_download(app: AppHandle, url: String, sha256: String, file: String, bytes: u64) -> Result<(), String> {
    if !allowed_url(&url) || !valid_model_file(&file) {
        return Err("Endereço do modelo inválido.".into());
    }
    let st = app.state::<State>();
    // dois downloads no mesmo .part embaralham o arquivo (e os dois terminam com SHA errado)
    let _busy = Busy::begin(&st.downloading).ok_or("Já há um download do modelo em andamento.")?;
    let dest = models_dir(&app)?.join(&file);
    if dest.exists() {
        return Ok(()); // só vira .gguf depois de conferido: baixar de novo seria 5 GB à toa
    }
    st.cancel_download.store(false, Ordering::Relaxed);
    *st.progress.lock().unwrap() = Some(Progress { received: 0, total: 0 });
    let client = reqwest::Client::new();
    let r = download_to(&client, &url, &sha256, bytes, &dest, &st.cancel_download, |received, total| {
        *st.progress.lock().unwrap() = Some(Progress { received, total });
    })
    .await;
    *st.progress.lock().unwrap() = None;
    r
}

/// Download em andamento (com `received == total` é a conferência do SHA-256), ou nada.
#[tauri::command]
pub fn ai_download_status(app: AppHandle) -> Option<Progress> {
    app.state::<State>().progress.lock().unwrap().clone()
}

#[tauri::command]
pub fn ai_cancel_download(app: AppHandle) {
    app.state::<State>().cancel_download.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub fn ai_delete_model(app: AppHandle, file: String) -> Result<(), String> {
    if !valid_model_file(&file) {
        return Err(BAD_FILE.into());
    }
    let st = app.state::<State>();
    if st.server.lock().unwrap().as_ref().is_some_and(|s| s.file == file) {
        stop(&st);
    }
    let path = models_dir(&app)?.join(&file);
    for p in [path.with_extension("gguf.part"), path] {
        match std::fs::remove_file(&p) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Não foi possível apagar o modelo: {e}")),
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_start(app: AppHandle, file: String, ctx: u32) -> Result<(), String> {
    if !valid_model_file(&file) {
        return Err(BAD_FILE.into());
    }
    let st = app.state::<State>();
    touch(&st);
    let _one = st.starting.lock().await;
    // antes do lock: no Windows detectar a GPU roda um processo, e o lock seguraria ai_post/ai_stop esse tempo todo
    let cpu_only = cfg!(windows) && hardware(&st).gpu.is_none();
    let (port, key) = {
        let mut srv = st.server.lock().unwrap();
        if let Some(s) = srv.as_mut() {
            if s.file == file && matches!(s.child.try_wait(), Ok(None)) {
                return Ok(());
            }
        }
        if let Some(s) = srv.take() {
            kill(s);
        }
        let model = models_dir(&app)?.join(&file);
        if !model.exists() {
            return Err("O modelo não está instalado.".into());
        }
        let port = std::net::TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map_err(|e| e.to_string())?.port();
        let key = random_key();
        let bin = sidecar(if cpu_only { "llama-server-cpu" } else { "llama-server" })?;
        let mut cmd = Command::new(bin);
        hidden(&mut cmd).args(server_args(&model, port, ctx)).env("LLAMA_API_KEY", &key);
        // shortcut: no Mac, se o app morrer sem RunEvent::Exit (panic=abort, crash) o servidor fica órfão; vigiar o pai se aparecer.
        let child = cmd.spawn().map_err(|e| format!("Não foi possível iniciar o modelo: {e}"))?;
        #[cfg(windows)]
        let _job = kill_on_close(&child);
        *srv = Some(Server { child, file, port, key: key.clone(), #[cfg(windows)] _job });
        (port, key)
    };
    start_watchdog(&app);
    let client = local_client()?;
    for _ in 0..240 {
        let exited = st.server.lock().unwrap().as_mut().is_none_or(|s| s.port != port || !matches!(s.child.try_wait(), Ok(None)));
        if exited {
            stop(&st);
            return Err("O modelo não conseguiu iniciar.".into());
        }
        if let Ok(r) = client.get(format!("http://127.0.0.1:{port}/health")).bearer_auth(&key).send().await {
            if r.status().is_success() {
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    stop(&st);
    Err("O modelo não respondeu. Tente de novo ou troque de modelo em Configurações.".into())
}

#[tauri::command]
pub fn ai_stop(app: AppHandle) {
    stop(&app.state::<State>());
}

#[tauri::command]
pub fn ai_abort(app: AppHandle) {
    app.state::<State>().abort_gen.fetch_add(1, Ordering::Relaxed);
}

/// POST no servidor local. Com `"stream": true` repassa o texto por `on_chunk`, manda "" no fim e devolve "".
#[tauri::command]
pub async fn ai_post(app: AppHandle, path: String, body: String, on_chunk: Channel<String>) -> Result<String, String> {
    if !path.starts_with('/') {
        return Err("Caminho inválido.".into());
    }
    let st = app.state::<State>();
    let (port, key) = st.server.lock().unwrap().as_ref().map(|s| (s.port, s.key.clone())).ok_or(NOT_ON)?;
    touch(&st);
    let generation = st.abort_gen.load(Ordering::Relaxed);
    let stream = serde_json::from_str::<serde_json::Value>(&body).ok().and_then(|v| v.get("stream")?.as_bool()).unwrap_or(false);
    let net = |e: reqwest::Error| format!("O modelo não respondeu: {e}");
    let mut resp = local_client()?
        .post(format!("http://127.0.0.1:{port}{path}"))
        .bearer_auth(&key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(net)?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), resp.text().await.unwrap_or_default()));
    }
    if !stream {
        return resp.text().await.map_err(net);
    }
    let mut buf = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(net)? {
        if st.abort_gen.load(Ordering::Relaxed) != generation {
            break;
        }
        buf.extend_from_slice(&chunk);
        let text = take_utf8(&mut buf);
        if !text.is_empty() {
            on_chunk.send(text).map_err(|e| e.to_string())?;
        }
        touch(&st);
    }
    on_chunk.send(String::new()).map_err(|e| e.to_string())?; // fim do stream: o front espera esta marca, que vem na ordem dos pedaços
    Ok(String::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn devices_pega_a_gpu_com_mais_memoria() {
        let out = "Available devices:\n  Vulkan0: Intel(R) UHD Graphics (4096 MiB, 3000 MiB free)\n  Vulkan1: NVIDIA GeForce RTX 3060 (8192 MiB, 7800 MiB free)\n";
        assert_eq!(parse_devices(out), Some(Gpu { name: "NVIDIA GeForce RTX 3060".into(), vram_mib: 8192 }));
        assert_eq!(parse_devices("Available devices:\n"), None);
    }

    #[test]
    fn nome_do_modelo_nao_sai_da_pasta() {
        assert!(valid_model_file("Qwen3-8B-Q4_K_M.gguf"));
        for bad in ["../x.gguf", "a/b.gguf", "a\\b.gguf", "x.bin", ".gguf", "a..b.gguf"] {
            assert!(!valid_model_file(bad), "{bad}");
        }
    }

    #[test]
    fn download_so_do_hugging_face() {
        assert!(allowed_url("https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf"));
        assert!(!allowed_url("http://huggingface.co/Qwen/x.gguf"));
        assert!(!allowed_url("https://huggingface.co.evil.com/x.gguf"));
    }

    #[test]
    fn servidor_so_escuta_na_maquina_e_sem_a_chave_na_linha_de_comando() {
        let args = server_args(Path::new("/m/x.gguf"), 4321, 8192);
        let s = args.join(" ");
        assert!(s.contains("--host 127.0.0.1") && s.contains("--port 4321") && s.contains("-c 8192") && s.contains("-m /m/x.gguf"));
        assert!(!s.contains("0.0.0.0") && !s.contains("api-key"));
    }

    #[test]
    fn utf8_cortado_espera_o_resto() {
        let e = "é".as_bytes();
        let mut buf = vec![b'a', e[0]];
        assert_eq!(take_utf8(&mut buf), "a");
        buf.push(e[1]);
        assert_eq!(take_utf8(&mut buf), "é");
        assert!(buf.is_empty());
    }

    #[test]
    fn um_download_por_vez() {
        let flag = AtomicBool::new(false);
        let first = Busy::begin(&flag).expect("o primeiro começa");
        assert!(Busy::begin(&flag).is_none(), "o segundo é recusado enquanto o primeiro roda");
        drop(first);
        assert!(Busy::begin(&flag).is_some(), "terminado (ou com erro), libera");
    }

    const BODY: &[u8] = b"0123456789";

    /// Servidor de uma requisição só; devolve a URL e a requisição recebida.
    fn serve(honor_range: bool) -> (String, std::sync::mpsc::Receiver<String>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut req = Vec::new();
            let mut b = [0u8; 1];
            while !req.ends_with(b"\r\n\r\n") && s.read(&mut b).unwrap() == 1 {
                req.push(b[0]);
            }
            let req = String::from_utf8(req).unwrap();
            let start = req.lines().find_map(|l| l.to_lowercase().strip_prefix("range: bytes=").map(|r| r.trim_end_matches('-').parse::<usize>().unwrap()));
            let (status, part) = match (honor_range, start) {
                (true, Some(n)) => ("206 Partial Content", &BODY[n..]),
                _ => ("200 OK", BODY),
            };
            write!(s, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", part.len()).unwrap();
            s.write_all(part).unwrap();
            tx.send(req).unwrap();
        });
        (format!("http://127.0.0.1:{port}/m.gguf"), rx)
    }

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("yield-ai-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("m.gguf")
    }

    fn sha(b: &[u8]) -> String {
        format!("{:x}", Sha256::digest(b))
    }

    fn run(url: &str, sha256: &str, dest: &Path) -> Result<(), String> {
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        tauri::async_runtime::block_on(download_to(&client, url, sha256, BODY.len() as u64, dest, &AtomicBool::new(false), |_, _| {}))
    }

    #[test]
    fn part_completo_so_confere_sem_ir_a_rede() {
        let dest = tmp("completo");
        std::fs::write(dest.with_extension("gguf.part"), BODY).unwrap();
        run("http://127.0.0.1:9/nada", &sha(BODY), &dest).unwrap(); // porta fechada: se tentasse baixar, falharia
        assert_eq!(std::fs::read(&dest).unwrap(), BODY);
    }

    #[test]
    fn download_continua_do_part() {
        let dest = tmp("range");
        std::fs::write(dest.with_extension("gguf.part"), &BODY[..4]).unwrap();
        let (url, rx) = serve(true);
        run(&url, &sha(BODY), &dest).unwrap();
        assert!(rx.recv().unwrap().to_lowercase().contains("range: bytes=4-"));
        assert_eq!(std::fs::read(&dest).unwrap(), BODY);
        assert!(!dest.with_extension("gguf.part").exists());
    }

    #[test]
    fn download_recomeca_se_o_servidor_ignora_o_range() {
        let dest = tmp("norange");
        std::fs::write(dest.with_extension("gguf.part"), &BODY[..4]).unwrap();
        let (url, _rx) = serve(false);
        run(&url, &sha(BODY), &dest).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), BODY);
    }

    #[test]
    fn download_com_sha_errado_apaga_tudo() {
        let dest = tmp("sha");
        let (url, _rx) = serve(true);
        assert_eq!(run(&url, &sha(b"outro"), &dest).unwrap_err(), "O arquivo baixado veio corrompido. Tente baixar de novo.");
        assert!(!dest.exists() && !dest.with_extension("gguf.part").exists());
    }
}
