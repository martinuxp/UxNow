mod audio;
mod binimum;
mod config;
mod fonts;
mod i18n;
mod listenbrainz;
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
    native_strings: Mutex<i18n::NativeStrings>,
    shutting_down: AtomicBool,
}

const TRAY_ID: &str = "main";

/// Tray menu entries whose text follows the UI language.
struct TrayItems {
    show: tauri::menu::MenuItem<tauri::Wry>,
    start: tauri::menu::MenuItem<tauri::Wry>,
    stop: tauri::menu::MenuItem<tauri::Wry>,
    quit: tauri::menu::MenuItem<tauri::Wry>,
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
/// `label` and `detail` are plain text or message descriptors (see `i18n`).
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UxPlayExecutable {
    effective_path: Option<String>,
    bundled_path: Option<String>,
}

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> AppConfig {
    state.config.lock().expect("config lock").clone()
}

#[tauri::command]
fn get_uxplay_executable(state: State<'_, AppState>) -> UxPlayExecutable {
    let config = state.config.lock().expect("config lock").clone();
    UxPlayExecutable {
        effective_path: config::discover_uxplay(&config, &state.resource_dir)
            .map(|path| path.to_string_lossy().into_owned()),
        bundled_path: config::bundled_uxplay(&state.resource_dir)
            .map(|path| path.to_string_lossy().into_owned()),
    }
}

#[tauri::command]
fn update_config(state: State<'_, AppState>, patch: Value) -> Result<AppConfig, String> {
    let refresh_lyrics = patch.get("onlineLyricsConsent").is_some()
        || patch.get("enabledProviders").is_some()
        || patch.get("spicyLyricsEnabled").is_some();
    let mut guard = state
        .config
        .lock()
        .map_err(|_| i18n::msg("backend.config.lockFailed"))?;
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
    let pages = {
        let strings = state
            .native_strings
            .lock()
            .map_err(|_| i18n::msg("backend.config.lockFailed"))?;
        spotify::CallbackPages {
            linked: strings.spotify_linked_page.clone(),
            mismatch: strings.spotify_mismatch_page.clone(),
        }
    };
    spotify::start_link(app, state.spotify.clone(), pages)
}

#[tauri::command]
fn set_native_strings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    strings: i18n::NativeStrings,
) -> Result<(), String> {
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.show.set_text(&strings.tray_show);
        let _ = items.start.set_text(&strings.tray_start);
        let _ = items.stop.set_text(&strings.tray_stop);
        let _ = items.quit.set_text(&strings.tray_quit);
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(&strings.tray_tooltip));
    }
    *state
        .native_strings
        .lock()
        .map_err(|_| i18n::msg("backend.config.lockFailed"))? = strings;
    Ok(())
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
        .ok_or_else(|| i18n::msg("backend.uxplay.notRunning"))?;
    let device = state
        .config
        .lock()
        .map_err(|_| "Config lock")?
        .preferred_audio_device_id
        .clone()
        .ok_or_else(|| i18n::msg("backend.uxplay.selectOutput"))?;
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
    let gst = gstreamer_output(uxplay_path.as_ref(), &["--version"]);
    let wasapi = gstreamer_output(uxplay_path.as_ref(), &["wasapisink"]);
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
                .unwrap_or_else(|| i18n::msg("backend.diagnostics.uxplayMissing")),
        ),
        gstreamer: item(
            !gst.is_empty(),
            "GStreamer",
            if gst.is_empty() {
                i18n::msg("backend.diagnostics.gstreamerMissing")
            } else {
                first_line(&gst)
            },
        ),
        wasapi: item(
            !wasapi.is_empty(),
            &i18n::msg("backend.diagnostics.wasapi"),
            i18n::msg(if wasapi.is_empty() {
                "backend.diagnostics.wasapiMissing"
            } else {
                "backend.diagnostics.wasapiAvailable"
            }),
        ),
        network: item(
            network.to_ascii_lowercase().contains("private"),
            &i18n::msg("backend.diagnostics.network"),
            if network.is_empty() {
                i18n::msg("backend.diagnostics.networkUnknown")
            } else {
                first_line(&network)
            },
        ),
        firewall: item(
            !firewall.is_empty(),
            "Firewall",
            i18n::msg(if firewall.is_empty() {
                "backend.diagnostics.firewallMissing"
            } else {
                "backend.diagnostics.firewallFound"
            }),
        ),
        audio: item(
            selected,
            &i18n::msg("backend.diagnostics.audio"),
            if selected {
                i18n::msg("backend.diagnostics.audioAvailable")
            } else {
                i18n::msg_with(
                    "backend.diagnostics.audioMissing",
                    &[("count", devices.len().to_string())],
                )
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

fn gstreamer_output(uxplay_path: Option<&PathBuf>, args: &[&str]) -> String {
    if let Some(gst) = uxplay_path.and_then(|path| config::bundled_gstreamer(path)) {
        let inspect = gst.bin_dir.join("gst-inspect-1.0.exe");
        if inspect.is_file() {
            let mut command = native_process::command(inspect);
            let mut path = vec![gst.bin_dir];
            if let Some(existing) = std::env::var_os("PATH") {
                path.extend(std::env::split_paths(&existing));
            }
            if let Ok(path) = std::env::join_paths(path) {
                command.env("PATH", path);
            }
            command
                .env("GST_PLUGIN_PATH_1_0", &gst.plugin_dir)
                .env("GST_PLUGIN_SYSTEM_PATH_1_0", &gst.plugin_dir);
            if let Some(scanner) = gst.scanner {
                command.env("GST_PLUGIN_SCANNER", scanner);
            }
            return command
                .args(args)
                .output()
                .ok()
                .filter(|output| output.status.success())
                .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
                .unwrap_or_default();
        }
    }
    command_output("gst-inspect-1.0", args)
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
            let resource_dir = match app.path().resource_dir() {
                Ok(path) => path,
                Err(_) => std::env::current_exe()?
                    .parent()
                    .ok_or_else(|| std::io::Error::other("No se encontró la carpeta de UxNow"))?
                    .to_path_buf(),
            };
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
                native_strings: Mutex::new(i18n::NativeStrings::default()),
                spotify: Arc::new(Mutex::new(spotify::Session::default())),
                shutting_down: AtomicBool::new(false),
            });

            // Base-language labels until the UI calls `set_native_strings`.
            let labels = i18n::NativeStrings::default();
            let show =
                tauri::menu::MenuItem::with_id(app, "show", &labels.tray_show, true, None::<&str>)?;
            let start = tauri::menu::MenuItem::with_id(
                app,
                "start",
                &labels.tray_start,
                true,
                None::<&str>,
            )?;
            let stop =
                tauri::menu::MenuItem::with_id(app, "stop", &labels.tray_stop, true, None::<&str>)?;
            let quit =
                tauri::menu::MenuItem::with_id(app, "quit", &labels.tray_quit, true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&show, &start, &stop, &quit])?;
            let mut tray = tauri::tray::TrayIconBuilder::with_id(TRAY_ID)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip(&labels.tray_tooltip);
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
            app.manage(TrayItems {
                show,
                start,
                stop,
                quit,
            });

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
                            let _ = handle.emit("uxplay://error", uxplay::UxPlayEvent { phase: "error".into(), message: i18n::msg("backend.uxplay.outputDisconnected"), client_id: None, position_ms: None, duration_ms: None });
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
            get_uxplay_executable,
            update_config,
            list_audio_devices,
            list_system_fonts,
            start_uxplay,
            get_spotify_link_status,
            start_spotify_link,
            set_native_strings,
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
