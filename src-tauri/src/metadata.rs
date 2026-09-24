use base64::{engine::general_purpose::STANDARD, Engine};
use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, thread, time::Duration};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMetadata {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: Option<u64>,
    pub cover_data_url: Option<String>,
    pub is_demo: bool,
}

pub fn start(app: AppHandle, directory: PathBuf) -> Result<(), String> {
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(value) => value,
            Err(_) => return,
        };
        if watcher
            .watch(&directory, RecursiveMode::NonRecursive)
            .is_err()
        {
            return;
        }
        while let Ok(event) = rx.recv() {
            if event.is_err() {
                continue;
            }
            thread::sleep(Duration::from_millis(90));
            let metadata_path = directory.join("now-playing.txt");
            if !metadata_path.exists() {
                continue;
            }
            if let Some(track) = read_track(&metadata_path, &directory.join("cover.jpg")) {
                let _ = app.emit("metadata://changed", track);
            }
        }
    });
    Ok(())
}

pub fn read_track(metadata: &PathBuf, cover: &PathBuf) -> Option<TrackMetadata> {
    let text = fs::read_to_string(metadata)
        .ok()?
        .trim_matches('\0')
        .to_string();
    let value = |keys: &[&str]| -> Option<String> {
        text.lines().find_map(|line| {
            let (key, value) = line.split_once([':', '='])?;
            keys.iter()
                .any(|candidate| key.trim().eq_ignore_ascii_case(candidate))
                .then(|| value.trim().trim_matches('"').to_string())
        })
    };
    let title = clean_metadata_value(
        value(&["title", "minm", "track"]).or_else(|| quoted(&text, "Title"))?,
    );
    let artist = clean_metadata_value(
        value(&["artist", "asar"])
            .or_else(|| quoted(&text, "Artist"))
            .unwrap_or_else(|| "Artista desconocido".into()),
    );
    let album = value(&["album", "asal"])
        .or_else(|| quoted(&text, "Album"))
        .map(clean_metadata_value)
        .filter(|value| !value.is_empty());
    let duration_ms = value(&["duration", "astm"]).and_then(|v| v.parse().ok());
    let cover_data_url = fs::read(cover)
        .ok()
        .map(|bytes| format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)));
    Some(TrackMetadata {
        title,
        artist,
        album,
        duration_ms,
        cover_data_url,
        is_demo: false,
    })
}

fn quoted(text: &str, label: &str) -> Option<String> {
    let start = text.find(label)? + label.len();
    let remainder = text[start..].trim_start_matches([' ', ':', '=']);
    if let Some(rest) = remainder.strip_prefix('"') {
        Some(rest.split('"').next()?.to_string())
    } else {
        remainder.lines().next().map(|v| v.trim().to_string())
    }
}

fn clean_metadata_value(value: String) -> String {
    let trimmed = value.trim().trim_matches('"');
    let lowercase = trimmed.to_lowercase();
    for badge in ["video disponible", "vídeo disponible", "video available"] {
        if lowercase == badge {
            return String::new();
        }
        if lowercase.ends_with(badge) {
            let prefix_end = trimmed.len().saturating_sub(badge.len());
            let prefix = trimmed[..prefix_end]
                .trim_end_matches([' ', '\t', '\r', '\n', '·', '•', '-', '|', '(', '[']);
            if !prefix.is_empty() {
                return prefix.to_string();
            }
        }
    }
    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_trailing_spotify_video_badges() {
        assert_eq!(
            clean_metadata_value("Paloma Mami • Video disponible".into()),
            "Paloma Mami"
        );
        assert_eq!(
            clean_metadata_value("Kate Bush · Video available".into()),
            "Kate Bush"
        );
        assert_eq!(
            clean_metadata_value("Artista legítimo".into()),
            "Artista legítimo"
        );
    }
}
