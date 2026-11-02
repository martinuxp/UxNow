//! The webview owns every text catalog (`src/i18n/locales/*.ts`), so Rust never
//! chooses a language for what it sends there. Instead of text it sends a
//! message descriptor, `{"key":"backend.uxplay.stopped","params":{...}}`, and
//! the UI translates it. Parameters carry raw values (paths, OS errors, uxPlay
//! log lines) or nested descriptors. Text that Rust draws itself (the tray menu
//! and the Spotify callback page) is pushed by the UI with `set_native_strings`.

use serde::Deserialize;
use serde_json::{json, Map, Value};

pub fn msg(key: &str) -> String {
    json!({ "key": key }).to_string()
}

pub fn msg_with(key: &str, params: &[(&str, String)]) -> String {
    let params: Map<String, Value> = params
        .iter()
        .map(|(name, value)| ((*name).to_string(), Value::String(value.clone())))
        .collect();
    json!({ "key": key, "params": params }).to_string()
}

/// Several messages shown together; the UI translates and joins them.
pub fn list(items: &[String]) -> String {
    json!({ "key": "backend.list", "params": { "items": items } }).to_string()
}

pub fn key_of(message: &str) -> Option<String> {
    serde_json::from_str::<Value>(message)
        .ok()?
        .get("key")?
        .as_str()
        .map(String::from)
}

/// Text for surfaces Rust renders outside the webview, in the UI language.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeStrings {
    pub tray_show: String,
    pub tray_start: String,
    pub tray_stop: String,
    pub tray_quit: String,
    pub tray_tooltip: String,
    pub spotify_linked_page: String,
    pub spotify_mismatch_page: String,
}

impl Default for NativeStrings {
    /// Spanish, the base language, until the UI sends its choice.
    fn default() -> Self {
        Self {
            tray_show: "Abrir UxNow".into(),
            tray_start: "Iniciar receptor".into(),
            tray_stop: "Detener receptor".into(),
            tray_quit: "Salir".into(),
            tray_tooltip: "UxNow · receptor AirPlay".into(),
            spotify_linked_page: "Spotify quedó vinculado. Puedes volver a UxNow.".into(),
            spotify_mismatch_page: "La respuesta de Spotify no coincidió. Vuelve a intentarlo."
                .into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_descriptors_the_ui_can_read() {
        assert_eq!(
            msg("backend.uxplay.stopped"),
            r#"{"key":"backend.uxplay.stopped"}"#
        );
        let nested = msg_with(
            "backend.lyrics.attribution",
            &[("source", msg("backend.lyrics.localCollection"))],
        );
        let value: Value = serde_json::from_str(&nested).unwrap();
        assert_eq!(
            value["params"]["source"],
            msg("backend.lyrics.localCollection")
        );
        assert_eq!(
            key_of(&nested).as_deref(),
            Some("backend.lyrics.attribution")
        );
        assert_eq!(key_of("uxPlay log line"), None);
    }

    #[test]
    fn lists_keep_each_message() {
        let value: Value = serde_json::from_str(&list(&[msg("a"), "raw".into()])).unwrap();
        assert_eq!(value["key"], "backend.list");
        assert_eq!(value["params"]["items"][1], "raw");
    }
}
