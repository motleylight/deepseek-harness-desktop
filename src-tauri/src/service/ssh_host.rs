//! 内置 SSH 插件的标准输入输出宿主；部署和 SSH 业务由插件实现。
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;

type Reply = Result<Value, String>;
struct Host {
    input: Mutex<Option<ChildStdin>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    dead: AtomicBool,
}
impl Host {
    fn close(&self) {
        self.dead.store(true, Ordering::SeqCst);
        self.input.lock().unwrap().take();
        for (_, sender) in self.pending.lock().unwrap().drain() {
            let _ = sender.send(Err(
                "SSH_PLUGIN_EXITED: inspect remote state before retrying a mutation".into(),
            ));
        }
    }
}
static HOST: OnceLock<Mutex<Option<Arc<Host>>>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn slot() -> &'static Mutex<Option<Arc<Host>>> {
    HOST.get_or_init(|| Mutex::new(None))
}

fn launch(app: &AppHandle) -> Result<Arc<Host>, String> {
    let mut current = slot().lock().map_err(|e| e.to_string())?;
    if let Some(host) = current
        .as_ref()
        .filter(|host| !host.dead.load(Ordering::SeqCst))
    {
        return Ok(Arc::clone(host));
    }
    let resource = app
        .path()
        .resource_dir()
        .map_err(|e| format!("SSH_RESOURCE: {e}"))?
        .join("resources/internal-plugins/dsh-tauri-ssh/src/worker.js");
    #[cfg(debug_assertions)]
    let resource = if resource.exists() {
        resource
    } else {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../plugins/dsh-tauri-ssh/src/worker.js")
    };
    if !resource.is_file() {
        return Err("SSH_PLUGIN_MISSING: reinstall the Desktop package".into());
    }
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("SSH_DATA: {e}"))?;
    let store = data.join(if cfg!(debug_assertions) {
        "ssh-connections.dev.json"
    } else {
        "ssh-connections.json"
    });
    let node = crate::config::get_local_node_path()
        .unwrap_or_else(|| crate::config::get_node_binary_path(app));
    let mut command = Command::new(node);
    command
        .arg(resource)
        .arg(store)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("SSH_PLUGIN_START: {e}"))?;
    let host = Arc::new(Host {
        input: Mutex::new(child.stdin.take()),
        pending: Mutex::new(HashMap::new()),
        dead: AtomicBool::new(false),
    });
    let output = child.stdout.take().ok_or("SSH_PLUGIN_STDOUT_MISSING")?;
    let errors = child.stderr.take().ok_or("SSH_PLUGIN_STDERR_MISSING")?;
    std::thread::spawn(move || {
        for line in BufReader::new(errors).lines().map_while(Result::ok) {
            log::warn!(
                "[ssh-plugin] {}",
                line.chars().take(2000).collect::<String>()
            );
        }
    });
    let reader_host = Arc::clone(&host);
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let Some(id) = message.get("id").and_then(Value::as_u64) else {
                continue;
            };
            if let Some(sender) = reader_host.pending.lock().unwrap().remove(&id) {
                let reply = if message.get("ok").and_then(Value::as_bool) == Some(true) {
                    Ok(message.get("value").cloned().unwrap_or(Value::Null))
                } else {
                    Err(message
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("SSH_PLUGIN_FAILED")
                        .to_string())
                };
                let _ = sender.send(reply);
            }
        }
        reader_host.close();
        let _ = child.wait();
    });
    *current = Some(Arc::clone(&host));
    Ok(host)
}

/// 请求只进入随包插件；不提供任意程序或脚本执行入口。
pub async fn request(app: AppHandle, method: String, params: Value) -> Reply {
    if !["list", "save", "remove", "enable", "operation"].contains(&method.as_str()) {
        return Err("SSH_METHOD_INVALID".into());
    }
    let host = launch(&app)?;
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let encoded = format!(
        "{}\n",
        json!({"id": id, "method": method, "params": params})
    );
    if encoded.len() > 65536 {
        return Err("SSH_REQUEST_TOO_LARGE".into());
    }
    let (sender, receiver) = oneshot::channel();
    {
        let mut pending = host.pending.lock().unwrap();
        if host.dead.load(Ordering::SeqCst) {
            return Err("SSH_PLUGIN_EXITED".into());
        }
        pending.insert(id, sender);
    }
    let write = host
        .input
        .lock()
        .unwrap()
        .as_mut()
        .ok_or_else(|| "SSH_PLUGIN_CLOSED".to_string())
        .and_then(|input| {
            input
                .write_all(encoded.as_bytes())
                .map_err(|e| format!("SSH_PLUGIN_WRITE: {e}"))
        });
    if let Err(error) = write {
        host.pending.lock().unwrap().remove(&id);
        return Err(error);
    }
    let result = tokio::time::timeout(std::time::Duration::from_secs(920), receiver).await;
    host.pending.lock().unwrap().remove(&id);
    match result {
        Ok(Ok(reply)) => reply,
        Ok(Err(_)) => Err("SSH_PLUGIN_REPLY_CLOSED".into()),
        Err(_) => Err("SSH_PLUGIN_TIMEOUT: inspect remote state before retrying".into()),
    }
}

/// 关闭输入管道触发插件清理本地隧道；远端服务不随桌面退出停止。
pub fn shutdown() {
    if let Some(host) = slot().lock().unwrap().take() {
        host.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn closing_host_rejects_all_waiters_and_is_idempotent() {
        let host = Host {
            input: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            dead: AtomicBool::new(false),
        };
        let (one, first) = oneshot::channel();
        let (two, second) = oneshot::channel();
        host.pending.lock().unwrap().insert(1, one);
        host.pending.lock().unwrap().insert(2, two);
        host.close();
        host.close();
        assert!(host.dead.load(Ordering::SeqCst));
        assert!(host.pending.lock().unwrap().is_empty());
        assert!(first
            .await
            .unwrap()
            .unwrap_err()
            .starts_with("SSH_PLUGIN_EXITED"));
        assert!(second
            .await
            .unwrap()
            .unwrap_err()
            .starts_with("SSH_PLUGIN_EXITED"));
    }
}
