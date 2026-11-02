use crate::{
    audio,
    config::{bundled_gstreamer, discover_uxplay, AppConfig},
    i18n,
};
use serde::Serialize;
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{AppHandle, Emitter};
use tokio::{io::AsyncReadExt, process::Child, sync::Mutex};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UxPlayEvent {
    pub phase: String,
    /// Message descriptor (see `i18n`), or a raw uxPlay log line for errors.
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

pub struct UxPlayRuntime {
    pub child: Mutex<Option<Child>>,
    pub process_id: Mutex<Option<u32>>,
    pub recent_logs: Mutex<VecDeque<String>>,
    pub stopping: AtomicBool,
}

impl Default for UxPlayRuntime {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            process_id: Mutex::new(None),
            recent_logs: Mutex::new(VecDeque::new()),
            stopping: AtomicBool::new(false),
        }
    }
}

pub fn build_args(config: &AppConfig, metadata: &Path, cover: &Path) -> Vec<String> {
    let mut args = vec![
        "-n".into(),
        config.receiver_name.clone(),
        "-nh".into(),
        "-vs".into(),
        "0".into(),
        "-md".into(),
        metadata.to_string_lossy().into_owned(),
        "-ca".into(),
        cover.to_string_lossy().into_owned(),
    ];
    if let Some(device) = config
        .preferred_audio_device_id
        .as_ref()
        .filter(|id| !id.is_empty())
    {
        let safe = device.replace('"', "\\\"");
        args.extend([
            "-as".into(),
            format!("wasapisink device=\"{safe}\" low-latency=true"),
        ]);
    } else {
        args.extend(["-as".into(), "wasapisink low-latency=true".into()]);
    }
    if config.pin_enabled {
        args.push("-pin".into());
        if config.pin.len() == 4 && config.pin.chars().all(|c| c.is_ascii_digit()) {
            args.push(config.pin.clone());
        }
        args.push("-reg".into());
    }
    args
}

pub async fn start(
    app: AppHandle,
    runtime: Arc<UxPlayRuntime>,
    config: AppConfig,
    resource_dir: PathBuf,
    runtime_dir: PathBuf,
) -> Result<(), String> {
    let mut child_guard = runtime.child.lock().await;
    if child_guard.is_some() {
        return Ok(());
    }
    let binary = discover_uxplay(&config, &resource_dir)
        .ok_or_else(|| i18n::msg("backend.uxplay.notFound"))?;
    std::fs::create_dir_all(&runtime_dir).map_err(|e| e.to_string())?;
    let metadata = runtime_dir.join("now-playing.txt");
    let cover = runtime_dir.join("cover.jpg");
    runtime.stopping.store(false, Ordering::Relaxed);
    runtime.recent_logs.lock().await.clear();
    emit(
        &app,
        "starting",
        i18n::msg_with(
            "backend.uxplay.starting",
            &[("path", binary.display().to_string())],
        ),
        None,
        None,
    );
    let mut command = crate::native_process::async_command(&binary);
    command
        .args(build_args(&config, &metadata, &cover))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .kill_on_drop(true);
    if let Some(gst) = bundled_gstreamer(&binary) {
        let mut paths = vec![gst.bin_dir];
        if let Some(existing) = std::env::var_os("PATH") {
            paths.extend(std::env::split_paths(&existing));
        }
        let path = std::env::join_paths(paths).map_err(|error| {
            i18n::msg_with(
                "backend.uxplay.invalidRuntimePath",
                &[("error", error.to_string())],
            )
        })?;
        command
            .env("PATH", path)
            .env("GST_PLUGIN_PATH_1_0", &gst.plugin_dir)
            .env("GST_PLUGIN_SYSTEM_PATH_1_0", &gst.plugin_dir);
        if let Some(scanner) = gst.scanner {
            command.env("GST_PLUGIN_SCANNER", scanner);
        }
    }
    let mut child = command
        .spawn()
        .map_err(|e| i18n::msg_with("backend.uxplay.spawnFailed", &[("error", e.to_string())]))?;
    let pid = child
        .id()
        .ok_or_else(|| i18n::msg("backend.uxplay.noProcessId"))?;
    *runtime.process_id.lock().await = Some(pid);
    if let Some(stdout) = child.stdout.take() {
        spawn_log_reader(app.clone(), runtime.clone(), stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_log_reader(app.clone(), runtime.clone(), stderr);
    }
    *child_guard = Some(child);
    drop(child_guard);
    let monitor_app = app.clone();
    let monitor_runtime = runtime.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let status = {
                let mut guard = monitor_runtime.child.lock().await;
                let Some(child) = guard.as_mut() else { break };
                match child.try_wait() {
                    Ok(Some(status)) => {
                        guard.take();
                        Some(status)
                    }
                    Ok(None) | Err(_) => None,
                }
            };
            if let Some(status) = status {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                *monitor_runtime.process_id.lock().await = None;
                audio::set_keep_awake(false);
                if monitor_runtime.stopping.load(Ordering::Relaxed) {
                    emit(
                        &monitor_app,
                        "stopped",
                        i18n::msg("backend.uxplay.stopped"),
                        None,
                        None,
                    );
                } else if status.success() {
                    emit(
                        &monitor_app,
                        "ready",
                        i18n::msg("backend.uxplay.sessionEndedExited"),
                        None,
                        None,
                    );
                } else {
                    let logs = monitor_runtime.recent_logs.lock().await;
                    let detail = diagnostic_from_logs(&logs);
                    drop(logs);
                    let message = match detail {
                        Some(detail) => i18n::msg_with(
                            "backend.uxplay.exitedWithDetail",
                            &[("status", status.to_string()), ("detail", detail)],
                        ),
                        None => i18n::msg_with(
                            "backend.uxplay.exited",
                            &[("status", status.to_string())],
                        ),
                    };
                    emit(&monitor_app, "error", message, None, None);
                }
                break;
            }
        }
    });
    if config.keep_awake {
        audio::set_keep_awake(true);
    }
    Ok(())
}

pub async fn stop(app: &AppHandle, runtime: &UxPlayRuntime) -> Result<(), String> {
    runtime.stopping.store(true, Ordering::Relaxed);
    if let Some(mut child) = runtime.child.lock().await.take() {
        child.kill().await.map_err(|e| {
            i18n::msg_with("backend.uxplay.stopFailed", &[("error", e.to_string())])
        })?;
        let _ = child.wait().await;
    }
    *runtime.process_id.lock().await = None;
    audio::set_keep_awake(false);
    emit(
        app,
        "stopped",
        i18n::msg("backend.uxplay.stopped"),
        None,
        None,
    );
    Ok(())
}

fn spawn_log_reader<R>(app: AppHandle, runtime: Arc<UxPlayRuntime>, mut reader: R)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut bytes = [0u8; 2048];
        let mut pending = String::new();
        loop {
            match reader.read(&mut bytes).await {
                Ok(0) => {
                    if !pending.trim().is_empty() {
                        handle_log_line(&app, &runtime, pending.trim()).await;
                    }
                    break;
                }
                Ok(count) => {
                    pending.push_str(&String::from_utf8_lossy(&bytes[..count]));
                    while let Some(index) = pending.find(['\n', '\r']) {
                        let line = pending[..index].trim().to_string();
                        pending.drain(..=index);
                        if !line.is_empty() {
                            handle_log_line(&app, &runtime, &line).await;
                        }
                    }
                }
                Err(error) => {
                    emit(
                        &app,
                        "error",
                        i18n::msg_with(
                            "backend.uxplay.readFailed",
                            &[("error", error.to_string())],
                        ),
                        None,
                        None,
                    );
                    break;
                }
            }
        }
    });
}

async fn handle_log_line(app: &AppHandle, runtime: &UxPlayRuntime, line: &str) {
    let mut logs = runtime.recent_logs.lock().await;
    if logs.len() == 30 {
        logs.pop_front();
    }
    logs.push_back(line.chars().take(500).collect());
    drop(logs);
    if let Some(event) = UxPlayLogAdapter::parse(line) {
        emit_event(app, event);
    }
}

fn diagnostic_from_logs(logs: &VecDeque<String>) -> Option<String> {
    logs.iter()
        .rev()
        .find(|line| {
            let lower = line.to_ascii_lowercase();
            (lower.contains("not found")
                || lower.contains("no element")
                || lower.contains("cannot be written")
                || lower.contains("failed")
                || lower.contains("error"))
                && !lower.contains("error: stopping")
                && !lower.contains("gst_parse_launch error")
        })
        .cloned()
}

fn emit(
    app: &AppHandle,
    phase: &str,
    message: String,
    position_ms: Option<u64>,
    duration_ms: Option<u64>,
) {
    emit_event(
        app,
        UxPlayEvent {
            phase: phase.into(),
            message,
            client_id: None,
            position_ms,
            duration_ms,
        },
    );
}

fn emit_event(app: &AppHandle, event: UxPlayEvent) {
    let event_name = match event.phase.as_str() {
        "ready"
            if matches!(
                i18n::key_of(&event.message).as_deref(),
                Some("backend.uxplay.sessionEndedExited" | "backend.uxplay.sessionEndedReady")
            ) =>
        {
            Some("uxplay://session-ended")
        }
        "ready" => Some("uxplay://receiver-ready"),
        "connecting" => Some("uxplay://client-connecting"),
        "streaming" if event.position_ms.is_some() => Some("uxplay://progress"),
        "streaming" => Some("uxplay://session-started"),
        "error" => Some("uxplay://error"),
        _ => None,
    };
    if let Some(name) = event_name {
        let _ = app.emit(name, event.clone());
    }
    let _ = app.emit("uxplay://event", event);
}

pub struct UxPlayLogAdapter;
impl UxPlayLogAdapter {
    pub fn parse(line: &str) -> Option<UxPlayEvent> {
        let lower = line.to_ascii_lowercase();
        if lower.contains("audio progress") {
            let position = field_time(line, "audio progress (min:sec):")?;
            let duration = field_time(line, "track length");
            return Some(UxPlayEvent {
                phase: "streaming".into(),
                message: i18n::msg("backend.uxplay.streaming"),
                client_id: None,
                position_ms: Some(position),
                duration_ms: duration,
            });
        }
        if lower.contains("initialized server")
            || lower.contains("uxplay is ready")
            || lower.contains("waiting for connections")
        {
            return Some(simple("ready", i18n::msg("backend.uxplay.ready")));
        }
        if lower.contains("client") && (lower.contains("attempt") || lower.contains("connecting")) {
            return Some(simple("connecting", i18n::msg("backend.uxplay.connecting")));
        }
        if lower.contains("audio connection")
            || lower.contains("raop connection")
            || lower.contains("audio session")
        {
            return Some(simple("streaming", i18n::msg("backend.uxplay.streaming")));
        }
        if lower.contains("connection closed")
            || lower.contains("client disconnected")
            || lower.contains("teardown")
        {
            return Some(simple(
                "ready",
                i18n::msg("backend.uxplay.sessionEndedReady"),
            ));
        }
        if lower.contains("error") || lower.contains("failed") || lower.contains("fatal") {
            return Some(simple("error", line));
        }
        None
    }
}

fn simple(phase: &str, message: impl Into<String>) -> UxPlayEvent {
    UxPlayEvent {
        phase: phase.into(),
        message: message.into(),
        client_id: None,
        position_ms: None,
        duration_ms: None,
    }
}
fn field_time(line: &str, marker: &str) -> Option<u64> {
    let start = line
        .to_ascii_lowercase()
        .find(&marker.to_ascii_lowercase())?
        + marker.len();
    let value = line[start..]
        .trim()
        .split([';', ' '])
        .find(|chunk| chunk.contains(':'))?;
    let mut parts = value
        .trim_matches(|c: char| !c.is_ascii_digit() && c != ':')
        .split(':');
    let minutes: u64 = parts.next()?.parse().ok()?;
    let seconds: u64 = parts.next()?.parse().ok()?;
    Some((minutes * 60 + seconds) * 1000)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn creates_wasapi_argument_without_shell_interpolation() {
        let config = AppConfig {
            preferred_audio_device_id: Some("{0.0.0}.\\{abc}".into()),
            ..Default::default()
        };
        let args = build_args(&config, Path::new("meta.txt"), Path::new("cover.jpg"));
        assert!(args
            .iter()
            .any(|arg| arg.contains("wasapisink device=\"{0.0.0}.\\{abc}\"")));
    }
    #[test]
    fn parses_progress() {
        let event = UxPlayLogAdapter::parse(
            "audio progress (min:sec):   1:02; remaining:  2:00; track length 3:02",
        )
        .unwrap();
        assert_eq!(event.position_ms, Some(62_000));
        assert_eq!(event.duration_ms, Some(182_000));
    }
    #[test]
    fn session_end_is_sent_as_a_translation_key() {
        let event = UxPlayLogAdapter::parse("Connection closed by client").unwrap();
        assert_eq!(event.phase, "ready");
        assert_eq!(
            i18n::key_of(&event.message).as_deref(),
            Some("backend.uxplay.sessionEndedReady")
        );
    }
    #[test]
    fn ignores_irrelevant_log_lines() {
        assert!(UxPlayLogAdapter::parse("ordinary diagnostic").is_none());
    }
    #[test]
    fn exit_diagnostic_prefers_missing_element_over_generic_error() {
        let logs = VecDeque::from([
            "gst_parse_launch error (audio 1):".into(),
            "no element \"level\"".into(),
            "*** ERROR: stopping".into(),
        ]);
        assert_eq!(
            diagnostic_from_logs(&logs).as_deref(),
            Some("no element \"level\"")
        );
    }
}
