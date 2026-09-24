mod audio;
mod binimum;
mod config;
mod fonts;
mod lyrics;
mod metadata;
mod native_process;
mod spicy;
mod spotify;
mod uxplay;

use config::AppConfig;
use serde::Serialize;
use serde_json::Value;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Emitter, Manager, State};
use uxplay::UxPlayRuntime;

struct AppState {
    config: Mutex<AppConfig>,
    config_path: PathBuf,
    db_path: PathBuf,
    runtime_dir: PathBuf,
    resource_dir: PathBuf,
    uxplay: Arc<UxPlayRuntime>,
    spotify: spotify::SharedSession,
    current_track: Mutex<Option<metadata::TrackMetadata>>,
    shutting_down: AtomicBool,
}

fn request_exit(app: tauri::AppHandle) {
    let runtime = {
        let state = app.state::<AppState>();
        if state.shutting_down.swap(true, Ordering::SeqCst) {
            return;
        }
        state.uxplay.clone()
    };
    tauri::async_runtime::spawn(async move {
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(3),
            uxplay::stop(&app, &runtime),
        )
        .await;
        app.exit(0);
    });
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticItem {
    ok: bool,
    label: String,
    detail: String,
}
#[derive(Serialize)]
struct Diagnostics {
    uxplay: DiagnosticItem,
    gstreamer: DiagnosticItem,
    wasapi: DiagnosticItem,
    network: DiagnosticItem,
    firewall: DiagnosticItem,
    audio: DiagnosticItem,
    binimum: DiagnosticItem,
}

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> AppConfig {
    state.config.lock().expect("config lock").clone()
}

#[tauri::command]
fn update_config(state: State<'_, AppState>, patch: Value) -> Result<AppConfig, String> {
    let refresh_lyrics = patch.get("onlineLyricsConsent").is_some()
        || patch.get("enabledProviders").is_some()
        || patch.get("spicyLyricsEnabled").is_some();
    let mut guard = state
        .config
        .lock()
        .map_err(|_| "No se pudo bloquear la configuración")?;
    let next = config::update(&guard, patch)?;
    config::save_atomic(&state.config_path, &next)?;
    *guard = next.clone();
    drop(guard);
    if refresh_lyrics {
        lyrics::clear_cache(&state.db_path)?;
    }
    Ok(next)
}

#[tauri::command]
fn list_audio_devices() -> Result<Vec<audio::AudioDevice>, String> {
    audio::list_devices()
}
#[tauri::command]
async fn get_spotify_link_status(
    state: State<'_, AppState>,
) -> Result<spotify::LinkStatus, String> {
    // Refresh lazily only when the saved access token has expired. The status
    // remains linked while a refresh credential is available in the OS store.
    let _ = spotify::access_token(&state.spotify).await;
    Ok(spotify::status(&state.spotify))
}

#[tauri::command]
fn start_spotify_link(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<spotify::LinkStatus, String> {
    spotify::start_link(app, state.spotify.clone())
}

#[tauri::command]
fn list_system_fonts() -> Vec<String> {
    fonts::list_system_fonts()
}

#[tauri::command]
async fn start_uxplay(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let config = { state.config.lock().map_err(|_| "Config lock")?.clone() };
    uxplay::start(
        app,
        state.uxplay.clone(),
        config,
        state.resource_dir.clone(),
        state.runtime_dir.clone(),
    )
    .await
}

#[tauri::command]
async fn stop_uxplay(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    uxplay::stop(&app, &state.uxplay).await
}

#[tauri::command]
async fn restart_uxplay(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    uxplay::stop(&app, &state.uxplay).await?;
    let config = { state.config.lock().map_err(|_| "Config lock")?.clone() };
    uxplay::start(
        app,
        state.uxplay.clone(),
        config,
        state.resource_dir.clone(),
        state.runtime_dir.clone(),
    )
    .await
}

#[tauri::command]
async fn set_stream_volume(state: State<'_, AppState>, volume: f32) -> Result<(), String> {
    let pid = state
        .uxplay
        .process_id
        .lock()
        .await
        .ok_or("uxPlay no está en ejecución")?;
    let device = state
        .config
        .lock()
        .map_err(|_| "Config lock")?
        .preferred_audio_device_id
        .clone()
        .ok_or("Selecciona una salida de audio")?;
    audio::set_process_volume(&device, pid, volume)
}

#[tauri::command]
fn list_library(state: State<'_, AppState>) -> Result<Vec<lyrics::LibraryEntry>, String> {
    lyrics::list_library(&state.db_path)
}
#[tauri::command]
fn index_lyrics_library(state: State<'_, AppState>) -> Result<Vec<lyrics::LibraryEntry>, String> {
    lyrics::index_library(
        &state.db_path,
        &state
            .config
            .lock()
            .map_err(|_| "Config lock")?
            .local_lyrics_folders,
    )
}
#[tauri::command]
fn remove_library_entry(
    state: State<'_, AppState>,
    id: i64,
) -> Result<Vec<lyrics::LibraryEntry>, String> {
    lyrics::remove_library_entry(&state.db_path, id)
}
#[tauri::command]
async fn resolve_lyrics(
    state: State<'_, AppState>,
    track: metadata::TrackMetadata,
) -> Result<Option<lyrics::LyricsCandidate>, String> {
    *state.current_track.lock().map_err(|_| "Track lock")? = Some(track.clone());
    lyrics::add_history(&state.db_path, &track)?;
    let config = { state.config.lock().map_err(|_| "Config lock")?.clone() };
    let spotify_token = spotify::access_token(&state.spotify).await.unwrap_or(None);
    lyrics::resolve(state.db_path.clone(), config, track, spotify_token).await
}
#[tauri::command]
async fn search_lyrics_alternatives(
    state: State<'_, AppState>,
    track: metadata::TrackMetadata,
) -> Result<Vec<lyrics::LyricsCandidate>, String> {
    let config = { state.config.lock().map_err(|_| "Config lock")?.clone() };
    let spotify_token = spotify::access_token(&state.spotify).await.unwrap_or(None);
    lyrics::alternatives(state.db_path.clone(), config, track, spotify_token).await
}
#[tauri::command]
fn pin_lyrics_candidate(
    state: State<'_, AppState>,
    track: metadata::TrackMetadata,
    candidate: lyrics::LyricsCandidate,
) -> Result<(), String> {
    lyrics::pin_candidate(&state.db_path, &track, &candidate)
}
#[tauri::command]
fn import_lyrics_for_current_track(
    state: State<'_, AppState>,
    path: String,
) -> Result<lyrics::LyricsCandidate, String> {
    let track = state
        .current_track
        .lock()
        .map_err(|_| "Track lock")?
        .clone()
        .unwrap_or(metadata::TrackMetadata {
            title: "Sesión actual".into(),
            artist: "UxNow".into(),
            album: None,
            duration_ms: None,
            cover_data_url: None,
            is_demo: false,
        });
    lyrics::import_file(PathBuf::from(path).as_path(), &track, &state.db_path)
}
#[tauri::command]
fn clear_lyrics_cache(state: State<'_, AppState>) -> Result<(), String> {
    lyrics::clear_cache(&state.db_path)
}
#[tauri::command]
fn reveal_file(path: String) -> Result<(), String> {
    native_process::command("explorer.exe")
        .arg(format!("/select,{path}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn run_diagnostics(state: State<'_, AppState>) -> Result<Diagnostics, String> {
    let config = state.config.lock().expect("config lock").clone();
    let uxplay_path = config::discover_uxplay(&config, &state.resource_dir);
    let gst = command_output("gst-inspect-1.0", &["--version"]);
    let wasapi = command_output("gst-inspect-1.0", &["wasapisink"]);
    let devices = audio::list_devices().unwrap_or_default();
    let selected = config
        .preferred_audio_device_id
        .as_ref()
        .map(|id| devices.iter().any(|device| &device.id == id))
        .unwrap_or(false);
    let network = command_output(
        "powershell",
        &[
            "-NoProfile",
            "-Command",
            "(Get-NetConnectionProfile | Select-Object -First 1 -ExpandProperty NetworkCategory)",
        ],
    );
    let firewall = uxplay_path.as_ref().map(|path| {
        let escaped = path.display().to_string().replace('\'', "''");
        command_output("powershell", &["-NoProfile", "-Command", &format!("Get-NetFirewallApplicationFilter -Program '{escaped}' -ErrorAction SilentlyContinue | Select-Object -First 1")])
    }).unwrap_or_default();
    Ok(Diagnostics {
        uxplay: item(
            uxplay_path.is_some(),
            "uxPlay",
            uxplay_path
                .map(|v| v.display().to_string())
                .unwrap_or("No encontrado; el modo demo sigue disponible".into()),
        ),
        gstreamer: item(
            !gst.is_empty(),
            "GStreamer",
            if gst.is_empty() {
                "No encontramos gst-inspect-1.0".into()
            } else {
                first_line(&gst)
            },
        ),
        wasapi: item(
            !wasapi.is_empty(),
            "Salida WASAPI",
            if wasapi.is_empty() {
                "Instala el plugin WASAPI de GStreamer".into()
            } else {
                "wasapisink disponible".into()
            },
        ),
        network: item(
            network.to_ascii_lowercase().contains("private"),
            "Red",
            if network.is_empty() {
                "No se pudo determinar el perfil".into()
            } else {
                first_line(&network)
            },
        ),
        firewall: item(
            !firewall.is_empty(),
            "Firewall",
            if firewall.is_empty() {
                "No encontramos una regla para uxPlay".into()
            } else {
                "Existe una regla asociada a uxPlay".into()
            },
        ),
        audio: item(
            selected,
            "Salida de UxNow",
            if selected {
                "Dispositivo disponible".into()
            } else {
                format!("{} salidas activas; selecciona una", devices.len())
            },
        ),
        binimum: {
            let (ok, detail) = binimum::diagnose().await;
            item(ok, "BiniLyrics", detail)
        },
    })
}

fn item(ok: bool, label: &str, detail: String) -> DiagnosticItem {
    DiagnosticItem {
        ok,
        label: label.into(),
        detail,
    }
}
fn first_line(value: &str) -> String {
    value.lines().next().unwrap_or(value).trim().to_string()
}
fn command_output(command: &str, args: &[&str]) -> String {
    native_process::command(command)
        .args(args)
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
        .unwrap_or_default()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            std::fs::create_dir_all(&data_dir)?;
            let config_path = config_dir.join("config.json");
            let db_path = data_dir.join("uxnow.sqlite3");
            let runtime_dir = data_dir.join("runtime");
            let resource_dir = app.path().resource_dir().unwrap_or_else(|_| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .unwrap()
                    .to_path_buf()
            });
            lyrics::init_db(&db_path).map_err(std::io::Error::other)?;
            metadata::start(app.handle().clone(), runtime_dir.clone())
                .map_err(std::io::Error::other)?;
            let initial_config = config::load(&config_path);
            let start_minimized = initial_config.start_minimized;
            app.manage(AppState {
                config: Mutex::new(initial_config),
                config_path,
                db_path,
                runtime_dir,
                resource_dir,
                uxplay: Arc::new(UxPlayRuntime::default()),
                current_track: Mutex::new(None),
                spotify: Arc::new(Mutex::new(spotify::Session::default())),
                shutting_down: AtomicBool::new(false),
            });

            let show =
                tauri::menu::MenuItem::with_id(app, "show", "Abrir UxNow", true, None::<&str>)?;
            let start = tauri::menu::MenuItem::with_id(
                app,
                "start",
                "Iniciar receptor",
                true,
                None::<&str>,
            )?;
            let stop = tauri::menu::MenuItem::with_id(
                app,
                "stop",
                "Detener receptor",
                true,
                None::<&str>,
            )?;
            let quit = tauri::menu::MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&show, &start, &stop, &quit])?;
            let mut tray = tauri::tray::TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("UxNow · receptor AirPlay");
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_tray_icon_event(|tray, event| {
                if let tauri::tray::TrayIconEvent::Click {
                    button: tauri::tray::MouseButton::Left,
                    ..
                } = event
                {
                    if let Some(window) = tray.app_handle().get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            })
            .on_menu_event(|app, event| match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => request_exit(app.clone()),
                "start" => {
                    let handle = app.clone();
                    let state = app.state::<AppState>();
                    let runtime = state.uxplay.clone();
                    let resource_dir = state.resource_dir.clone();
                    let runtime_dir = state.runtime_dir.clone();
                    let config = state.config.lock().expect("config lock").clone();
                    tauri::async_runtime::spawn(async move {
                        let _ =
                            uxplay::start(handle, runtime, config, resource_dir, runtime_dir).await;
                    });
                }
                "stop" => {
                    let handle = app.clone();
                    let runtime = app.state::<AppState>().uxplay.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = uxplay::stop(&handle, &runtime).await;
                    });
                }
                _ => {}
            })
            .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                if start_minimized {
                    let _ = window.hide();
                }
                let window_for_close = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_for_close.hide();
                    }
                });
            }

            let audio_app = app.handle().clone();
            std::thread::spawn(move || {
                let mut previous = String::new();
                let mut selected_was_available = false;
                loop {
                    let devices = audio::list_devices().unwrap_or_default();
                    let signature = serde_json::to_string(&devices).unwrap_or_default();
                    if signature != previous {
                        previous = signature;
                        let _ = audio_app.emit("audio://devices-changed", devices.clone());
                    }
                    let selected = audio_app.state::<AppState>().config.lock().ok().and_then(|config| config.preferred_audio_device_id.clone());
                    let selected_is_available = selected.as_ref().is_some_and(|id| devices.iter().any(|device| &device.id == id));
                    if selected_was_available && !selected_is_available {
                        let handle = audio_app.clone();
                        let runtime = audio_app.state::<AppState>().uxplay.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = uxplay::stop(&handle, &runtime).await;
                            let _ = handle.emit("uxplay://error", uxplay::UxPlayEvent { phase: "error".into(), message: "La salida de UxNow se desconectó. Selecciona otra antes de reconectar AirPlay.".into(), client_id: None, position_ms: None, duration_ms: None });
                        });
                    }
                    selected_was_available = selected_is_available;
                    std::thread::sleep(std::time::Duration::from_secs(3));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            update_config,
            list_audio_devices,
            list_system_fonts,
            start_uxplay,
            get_spotify_link_status,
            start_spotify_link,
            stop_uxplay,
            restart_uxplay,
            set_stream_volume,
            list_library,
            index_lyrics_library,
            remove_library_entry,
            resolve_lyrics,
            search_lyrics_alternatives,
            pin_lyrics_candidate,
            import_lyrics_for_current_track,
            clear_lyrics_cache,
            reveal_file,
            run_diagnostics
        ])
        .run(tauri::generate_context!())
        .expect("error while running UxNow");
}
