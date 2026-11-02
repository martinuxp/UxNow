use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppConfig {
    pub receiver_name: String,
    pub uxplay_path: String,
    pub pin_enabled: bool,
    pub pin: String,
    pub preferred_audio_device_id: Option<String>,
    pub start_with_windows: bool,
    pub start_minimized: bool,
    pub demo_mode: bool,
    pub online_lyrics_consent: bool,
    pub local_lyrics_folders: Vec<String>,
    pub provider_order: Vec<String>,
    pub enabled_providers: Vec<String>,
    pub keep_awake: bool,
    pub spicy_lyrics_enabled: bool,
    pub ui_font: String,
    pub lyrics_font: String,
    pub global_lyrics_offset_ms: i64,
    pub sync_with_uxplay_progress: bool,
    /// UI language code; empty until the UI detects the system language.
    pub language: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            receiver_name: "UxNow".into(),
            uxplay_path: String::new(),
            pin_enabled: false,
            pin: String::new(),
            preferred_audio_device_id: None,
            start_with_windows: false,
            start_minimized: false,
            demo_mode: true,
            online_lyrics_consent: false,
            local_lyrics_folders: Vec::new(),
            provider_order: vec!["local", "cache", "binimum", "unison", "lrclib"]
                .into_iter()
                .map(String::from)
                .collect(),
            enabled_providers: vec!["binimum", "unison", "lrclib"]
                .into_iter()
                .map(String::from)
                .collect(),
            keep_awake: true,
            ui_font: "Google Sans Flex".into(),
            spicy_lyrics_enabled: false,
            lyrics_font: "Google Sans Flex SemiBold".into(),
            global_lyrics_offset_ms: 0,
            sync_with_uxplay_progress: true,
            language: String::new(),
        }
    }
}

pub fn load(path: &Path) -> AppConfig {
    let mut config = fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    ensure_provider_defaults(&mut config);
    config.global_lyrics_offset_ms = config.global_lyrics_offset_ms.clamp(-5000, 5000);
    config
}

fn ensure_provider_defaults(config: &mut AppConfig) {
    const PROVIDERS: [&str; 3] = ["binimum", "unison", "lrclib"];
    config.provider_order = ["local", "cache"]
        .into_iter()
        .chain(PROVIDERS)
        .map(String::from)
        .collect();
    config
        .enabled_providers
        .retain(|provider| PROVIDERS.contains(&provider.as_str()));
}

pub fn update(config: &AppConfig, patch: Value) -> Result<AppConfig, String> {
    let mut value = serde_json::to_value(config).map_err(|e| e.to_string())?;
    let target = value
        .as_object_mut()
        .ok_or_else(|| crate::i18n::msg("backend.config.internalInvalid"))?;
    let incoming = patch
        .as_object()
        .ok_or_else(|| crate::i18n::msg("backend.config.patchNotObject"))?;
    for (key, value) in incoming {
        if target.contains_key(key) {
            target.insert(key.clone(), value.clone());
        }
    }
    let mut next: AppConfig = serde_json::from_value(value).map_err(|e| {
        crate::i18n::msg_with("backend.config.invalid", &[("error", e.to_string())])
    })?;
    next.global_lyrics_offset_ms = next.global_lyrics_offset_ms.clamp(-5000, 5000);
    Ok(next)
}

pub fn save_atomic(path: &Path, config: &AppConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    fs::rename(tmp, path).map_err(|e| e.to_string())
}

pub fn discover_uxplay(config: &AppConfig, resource_dir: &Path) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    let previous_bundled_path = is_bundled_path(&config.uxplay_path);
    if !config.uxplay_path.trim().is_empty() && !previous_bundled_path {
        candidates.push(PathBuf::from(&config.uxplay_path));
    }
    if let Some(bundled) = bundled_uxplay(resource_dir) {
        candidates.push(bundled);
    }
    if previous_bundled_path {
        candidates.push(PathBuf::from(&config.uxplay_path));
    }
    #[cfg(debug_assertions)]
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../_internal/bin/uxplay.exe"));
    candidates.push(resource_dir.join("runtime/uxplay.exe"));
    candidates.push(resource_dir.join("vendor/uxplay/build/uxplay.exe"));
    if let Ok(path) = std::env::var("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|entry| entry.join("uxplay.exe")));
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn is_bundled_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/").to_ascii_lowercase();
    normalized == "_internal/bin/uxplay.exe"
        || normalized.ends_with("/_internal/bin/uxplay.exe")
}

pub fn bundled_uxplay(resource_dir: &Path) -> Option<PathBuf> {
    let mut candidates = vec![resource_dir.join("_internal/bin/uxplay.exe")];
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            candidates.push(directory.join("_internal/bin/uxplay.exe"));
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

pub struct BundledGStreamer {
    pub bin_dir: PathBuf,
    pub plugin_dir: PathBuf,
    pub scanner: Option<PathBuf>,
}

pub fn bundled_gstreamer(binary: &Path) -> Option<BundledGStreamer> {
    let bin_dir = binary.parent()?;
    let runtime_dir = bin_dir.parent()?;
    let plugin_dir = runtime_dir.join("lib/gstreamer-1.0");
    let scanner = runtime_dir.join("libexec/gstreamer-1.0/gst-plugin-scanner.exe");
    (bin_dir.join("libgstreamer-1.0-0.dll").is_file()
        && plugin_dir.join("libgstwasapi.dll").is_file())
    .then(|| BundledGStreamer {
        bin_dir: bin_dir.to_path_buf(),
        plugin_dir,
        scanner: scanner.is_file().then_some(scanner),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_uxplay_is_the_default_when_no_custom_path_is_set() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("uxnow-bundled-{stamp}"));
        let bin = root.join("_internal/bin");
        fs::create_dir_all(&bin).expect("create bundled path");
        let executable = bin.join("uxplay.exe");
        fs::write(&executable, b"test").expect("create bundled executable");
        let found = discover_uxplay(&AppConfig::default(), &root);
        assert_eq!(found, Some(executable));

        let custom_bin = root.join("custom");
        fs::create_dir_all(&custom_bin).expect("custom bin");
        let custom = custom_bin.join("uxplay.exe");
        fs::write(&custom, b"custom").expect("custom executable");
        let config = AppConfig {
            uxplay_path: custom.to_string_lossy().into_owned(),
            ..AppConfig::default()
        };
        assert_eq!(discover_uxplay(&config, &root), Some(custom));
        fs::remove_dir_all(root).expect("cleanup bundled path");
    }

    #[test]
    fn current_bundle_wins_over_an_older_bundle_path() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("uxnow-upgrade-{stamp}"));
        let current_bin = root.join("current/_internal/bin");
        let older_bin = root.join("older/_internal/bin");
        fs::create_dir_all(&current_bin).expect("current bin");
        fs::create_dir_all(&older_bin).expect("older bin");
        let current = current_bin.join("uxplay.exe");
        let older = older_bin.join("uxplay.exe");
        fs::write(&current, b"current").expect("current executable");
        fs::write(&older, b"older").expect("older executable");
        let config = AppConfig {
            uxplay_path: older.to_string_lossy().into_owned(),
            ..AppConfig::default()
        };
        assert_eq!(discover_uxplay(&config, &root.join("current")), Some(current));
        fs::remove_dir_all(root).expect("cleanup upgrade paths");
    }

    #[test]
    fn older_configurations_receive_typography_defaults() {
        let mut config: AppConfig = serde_json::from_value(serde_json::json!({
            "receiverName": "Sala",
            "demoMode": false
        }))
        .expect("legacy config");
        ensure_provider_defaults(&mut config);
        assert_eq!(config.receiver_name, "Sala");
        assert!(!config.demo_mode);
        assert_eq!(config.ui_font, "Google Sans Flex");
        assert_eq!(config.lyrics_font, "Google Sans Flex SemiBold");
        assert_eq!(config.global_lyrics_offset_ms, 0);
        assert_eq!(
            config.provider_order,
            ["local", "cache", "binimum", "unison", "lrclib"]
        );
        assert_eq!(config.enabled_providers, ["binimum", "unison", "lrclib"]);
        assert!(!config.spicy_lyrics_enabled);
    }

    #[test]
    fn disabling_every_online_provider_survives_reload() {
        let config = AppConfig {
            enabled_providers: Vec::new(),
            ..AppConfig::default()
        };
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("uxnow-providers-{suffix}.json"));
        save_atomic(&path, &config).expect("save config");
        assert!(load(&path).enabled_providers.is_empty());
        fs::remove_file(path).expect("cleanup");
    }

    #[test]
    fn global_offset_is_independent_and_bounded() {
        let legacy: AppConfig =
            serde_json::from_value(serde_json::json!({ "receiverName": "Sala" }))
                .expect("legacy config");
        assert_eq!(legacy.global_lyrics_offset_ms, 0);
        assert!(legacy.sync_with_uxplay_progress);

        let adjusted = update(&legacy, serde_json::json!({ "globalLyricsOffsetMs": 750 }))
            .expect("update global correction");
        assert_eq!(adjusted.global_lyrics_offset_ms, 750);
        assert!(adjusted.sync_with_uxplay_progress);
        assert_eq!(legacy.global_lyrics_offset_ms, 0);

        let without_progress_sync = update(
            &adjusted,
            serde_json::json!({ "syncWithUxplayProgress": false }),
        )
        .expect("disable progress synchronization");
        assert!(!without_progress_sync.sync_with_uxplay_progress);
        assert_eq!(without_progress_sync.global_lyrics_offset_ms, 750);

        let bounded = update(
            &adjusted,
            serde_json::json!({ "globalLyricsOffsetMs": 9000 }),
        )
        .expect("bound global correction");
        assert_eq!(bounded.global_lyrics_offset_ms, 5000);
    }

    #[test]
    fn discovers_the_user_supplied_local_runtime() {
        let binary = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../_internal/bin/uxplay.exe");
        if !binary.is_file() {
            return;
        }
        let config = AppConfig::default();
        let found = discover_uxplay(&config, Path::new("unused-resources"));
        assert_eq!(found.as_deref(), Some(binary.as_path()));
        let gst = bundled_gstreamer(&binary).expect("GStreamer next to uxplay.exe");
        assert!(gst.plugin_dir.join("libgstwasapi.dll").is_file());
    }
}
