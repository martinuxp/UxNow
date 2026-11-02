use crate::{config::AppConfig, i18n, metadata::TrackMetadata};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsCandidate {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: Option<u64>,
    pub sync_type: String,
    pub format: String,
    pub content: String,
    pub translation: Option<String>,
    pub source: String,
    pub attribution: String,
    #[serde(default)]
    pub attribution_links: Vec<AttributionLink>,
    pub source_url: Option<String>,
    pub confidence: f32,
    pub offset_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttributionLink {
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub id: i64,
    pub path: String,
    pub file_name: String,
    pub format: String,
    pub parse_error: Option<String>,
    pub associated_track: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrclibItem {
    id: i64,
    track_name: String,
    artist_name: String,
    album_name: Option<String>,
    duration: Option<f64>,
    synced_lyrics: Option<String>,
    plain_lyrics: Option<String>,
}

pub fn init_db(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, file_name TEXT NOT NULL, format TEXT NOT NULL, parse_error TEXT, modified INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS associations (track_key TEXT PRIMARY KEY, library_id INTEGER, candidate_json TEXT, offset_ms INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(library_id) REFERENCES library(id));
      CREATE TABLE IF NOT EXISTS lyrics_cache (track_key TEXT PRIMARY KEY, candidate_json TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
      CREATE TABLE IF NOT EXISTS lyric_offsets (track_key TEXT NOT NULL, candidate_id TEXT NOT NULL, offset_ms INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(track_key,candidate_id));
      CREATE TABLE IF NOT EXISTS ignored_library (path TEXT PRIMARY KEY, ignored_at INTEGER NOT NULL DEFAULT (unixepoch()));
      CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, track_key TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT, played_at INTEGER NOT NULL DEFAULT (unixepoch()));")
      .map_err(|e| e.to_string())
}

pub fn list_library(db: &Path) -> Result<Vec<LibraryEntry>, String> {
    let conn = Connection::open(db).map_err(|e| e.to_string())?;
    let mut statement = conn.prepare("SELECT l.id,l.path,l.file_name,l.format,l.parse_error,a.track_key FROM library l LEFT JOIN associations a ON a.library_id=l.id ORDER BY l.file_name COLLATE NOCASE").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(LibraryEntry {
                id: row.get(0)?,
                path: row.get(1)?,
                file_name: row.get(2)?,
                format: row.get(3)?,
                parse_error: row.get(4)?,
                associated_track: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn index_library(db: &Path, folders: &[String]) -> Result<Vec<LibraryEntry>, String> {
    let mut conn = Connection::open(db).map_err(|e| e.to_string())?;
    let ignored = {
        let mut statement = conn
            .prepare("SELECT path FROM ignored_library")
            .map_err(|e| e.to_string())?;
        let paths = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect::<HashSet<_>>();
        paths
    };
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut seen = HashSet::new();
    for folder in folders {
        for entry in WalkDir::new(folder)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
        {
            let path = entry.path();
            let Some(ext) = path
                .extension()
                .and_then(|v| v.to_str())
                .map(str::to_ascii_lowercase)
            else {
                continue;
            };
            if !matches!(ext.as_str(), "ttml" | "lrc" | "elrc") {
                continue;
            }
            let path_string = path.to_string_lossy().into_owned();
            if ignored.contains(&path_string) {
                continue;
            }
            seen.insert(path_string.clone());
            let metadata = entry.metadata().ok();
            let error =
                validate_file(path, &ext, metadata.as_ref().map(|m| m.len()).unwrap_or(0)).err();
            let modified = metadata
                .and_then(|m| m.modified().ok())
                .and_then(|v| v.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|v| v.as_secs() as i64)
                .unwrap_or(0);
            tx.execute("INSERT INTO library(path,file_name,format,parse_error,modified) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(path) DO UPDATE SET file_name=excluded.file_name,format=excluded.format,parse_error=excluded.parse_error,modified=excluded.modified",
                params![path_string, entry.file_name().to_string_lossy(), ext, error, modified]).map_err(|e| e.to_string())?;
        }
    }
    let stale = {
        let mut statement = tx
            .prepare("SELECT id,path FROM library")
            .map_err(|e| e.to_string())?;
        let entries = statement
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .filter(|(_, path)| !seen.contains(path))
            .collect::<Vec<_>>();
        entries
    };
    for (id, _) in stale {
        tx.execute(
            "UPDATE associations SET library_id=NULL WHERE library_id=?1",
            [id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM library WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    list_library(db)
}

pub fn remove_library_entry(db: &Path, id: i64) -> Result<Vec<LibraryEntry>, String> {
    let conn = Connection::open(db).map_err(|e| e.to_string())?;
    let path = conn
        .query_row("SELECT path FROM library WHERE id=?1", [id], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|_| i18n::msg("backend.lyrics.notInLibrary"))?;
    conn.execute(
        "INSERT INTO ignored_library(path) VALUES(?1) ON CONFLICT(path) DO UPDATE SET ignored_at=unixepoch()",
        [&path],
    )
    .map_err(|e| e.to_string())?;
    remove_candidates_for_path(&conn, &path)?;
    conn.execute(
        "UPDATE associations SET library_id=NULL WHERE library_id=?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM library WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    list_library(db)
}

fn remove_candidates_for_path(conn: &Connection, path: &str) -> Result<(), String> {
    for (table, key_column) in [("associations", "track_key"), ("lyrics_cache", "track_key")] {
        let sql = format!(
            "SELECT {key_column},candidate_json FROM {table} WHERE candidate_json IS NOT NULL"
        );
        let mut statement = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let keys = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .filter_map(|(key, json)| {
                serde_json::from_str::<LyricsCandidate>(&json)
                    .ok()
                    .map(|value| (key, value))
            })
            .filter(|(_, candidate)| candidate.source_url.as_deref() == Some(path))
            .map(|(key, _)| key)
            .collect::<Vec<_>>();
        drop(statement);
        for key in keys {
            conn.execute(&format!("DELETE FROM {table} WHERE {key_column}=?1"), [key])
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn validate_file(path: &Path, format: &str, size: u64) -> Result<(), String> {
    if size > 2 * 1024 * 1024 {
        return Err(i18n::msg("backend.lyrics.fileTooLarge"));
    }
    let text = fs::read_to_string(path).map_err(|_| i18n::msg("backend.lyrics.notUtf8"))?;
    if format == "ttml" && !(text.contains("<tt") && text.contains("</tt>")) {
        return Err(i18n::msg("backend.lyrics.invalidTtml"));
    }
    if matches!(format, "lrc" | "elrc")
        && !text
            .lines()
            .any(|line| line.contains('[') && line.contains(']'))
    {
        return Err(i18n::msg("backend.lyrics.noTimestamps"));
    }
    Ok(())
}

pub fn import_file(
    path: &Path,
    track: &TrackMetadata,
    db: &Path,
) -> Result<LyricsCandidate, String> {
    let format = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(format.as_str(), "ttml" | "lrc" | "elrc") {
        return Err(i18n::msg("backend.lyrics.unsupportedFormat"));
    }
    validate_file(
        path,
        &format,
        fs::metadata(path).map_err(|e| e.to_string())?.len(),
    )?;
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let candidate = LyricsCandidate {
        id: hash(&format!("{}:{content}", path.display())),
        title: track.title.clone(),
        artist: track.artist.clone(),
        album: track.album.clone(),
        duration_ms: track.duration_ms,
        sync_type: if format == "ttml" && content.contains("<span") {
            "word".into()
        } else {
            "line".into()
        },
        format,
        content,
        translation: None,
        source: "local".into(),
        attribution: attribution(i18n::msg("backend.lyrics.localCollection")),
        attribution_links: Vec::new(),
        source_url: Some(path.to_string_lossy().into_owned()),
        confidence: 1.0,
        offset_ms: 0,
    };
    let conn = Connection::open(db).map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO associations(track_key,candidate_json,offset_ms) VALUES(?1,?2,0) ON CONFLICT(track_key) DO UPDATE SET candidate_json=excluded.candidate_json,offset_ms=0", params![song_key(track), serde_json::to_string(&candidate).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
    Ok(candidate)
}

pub async fn resolve(
    db: PathBuf,
    config: AppConfig,
    track: TrackMetadata,
    spotify_token: Option<String>,
) -> Result<Option<LyricsCandidate>, String> {
    let key = track_key(&track);
    let mut fallback = None;
    let mut provider_failures = Vec::new();

    if let Some(candidate) = pinned_candidate(&db, &track)? {
        return Ok(Some(candidate));
    }
    for candidate in local_matches(&db, &track)? {
        if let Some(candidate) = consider_candidate(candidate, &mut fallback) {
            cache(&db, &key, &candidate)?;
            return Ok(Some(candidate));
        }
    }
    for candidate in from_db_candidates(&db, &key)? {
        if let Some(candidate) = consider_candidate(candidate, &mut fallback) {
            cache(&db, &key, &candidate)?;
            return Ok(Some(candidate));
        }
    }

    if config.online_lyrics_consent {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(6))
            .user_agent("UxNow/0.1")
            .build()
            .map_err(|_| i18n::msg("backend.lyrics.onlineSetupFailed"))?;
        if config.spicy_lyrics_enabled {
            match crate::spicy::find(&client, &track, spotify_token.as_deref()).await {
                Ok(Some(candidate)) => {
                    if let Some(candidate) = consider_candidate(candidate, &mut fallback) {
                        cache(&db, &key, &candidate)?;
                        return Ok(Some(candidate));
                    }
                }
                Ok(None) => {}
                Err(error) => provider_failures.push(error),
            }
        }
        for provider in &config.provider_order {
            if !config.enabled_providers.contains(provider) {
                continue;
            }
            let found = match provider.as_str() {
                "binimum" => crate::binimum::find(&client, &track).await,
                "unison" => unison(&client, &track).await,
                "lrclib" => lrclib(&client, &track).await,
                _ => Ok(None),
            };
            match found {
                Ok(Some(candidate)) => {
                    if let Some(candidate) = consider_candidate(candidate, &mut fallback) {
                        cache(&db, &key, &candidate)?;
                        return Ok(Some(candidate));
                    }
                }
                Ok(None) => {}
                Err(error) if provider == "binimum" => provider_failures.push(error),
                Err(_) => {}
            }
        }
    }

    if let Some(candidate) = fallback {
        cache(&db, &key, &candidate)?;
        return Ok(Some(candidate));
    }
    if !provider_failures.is_empty() {
        return Err(i18n::list(&provider_failures));
    }
    Ok(None)
}
pub async fn alternatives(
    db: PathBuf,
    config: AppConfig,
    track: TrackMetadata,
    spotify_token: Option<String>,
) -> Result<Vec<LyricsCandidate>, String> {
    let key = track_key(&track);
    let mut result = local_matches(&db, &track)?;
    if let Some(pinned) = pinned_candidate(&db, &track)? {
        result.insert(0, pinned);
    }
    result.extend(from_db_candidates(&db, &key)?);

    if config.online_lyrics_consent {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(4))
            .user_agent("UxNow/0.1 (+https://github.com/uxnow/uxnow)")
            .build()
            .map_err(|e| e.to_string())?;
        for provider in &config.provider_order {
            if !config.enabled_providers.contains(provider) {
                continue;
            }
            let found = match provider.as_str() {
                "binimum" => crate::binimum::find(&client, &track).await,
                "unison" => unison(&client, &track).await,
                "lrclib" => lrclib(&client, &track).await,
                _ => Ok(None),
            };
            if let Ok(Some(value)) = found {
                result.push(value);
            }
        }
        if config.spicy_lyrics_enabled {
            if let Ok(Some(value)) =
                crate::spicy::find(&client, &track, spotify_token.as_deref()).await
            {
                result.push(value);
            }
        }
    }

    for candidate in &mut result {
        candidate.offset_ms = 0;
    }
    result.sort_by_key(|candidate| std::cmp::Reverse(sync_quality(candidate)));
    let mut seen = HashSet::new();
    result.retain(|candidate| seen.insert(candidate.id.clone()));
    Ok(result)
}
pub fn pin_candidate(
    db: &Path,
    track: &TrackMetadata,
    candidate: &LyricsCandidate,
) -> Result<(), String> {
    let mut pinned = candidate.clone();
    pinned.offset_ms = 0;
    Connection::open(db).map_err(|e| e.to_string())?.execute(
        "INSERT INTO associations(track_key,candidate_json,offset_ms) VALUES(?1,?2,0) ON CONFLICT(track_key) DO UPDATE SET candidate_json=excluded.candidate_json,offset_ms=0",
        params![song_key(track), serde_json::to_string(&pinned).map_err(|e| e.to_string())?],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn add_history(db: &Path, track: &TrackMetadata) -> Result<(), String> {
    let conn = Connection::open(db).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO history(track_key,title,artist,album) VALUES(?1,?2,?3,?4)",
        params![track_key(track), track.title, track.artist, track.album],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY played_at DESC, id DESC LIMIT 200)", []).map_err(|e| e.to_string())?;
    Ok(())
}

fn from_db_candidates(db: &Path, key: &str) -> Result<Vec<LyricsCandidate>, String> {
    let conn = Connection::open(db).map_err(|e| e.to_string())?;
    let mut candidates = Vec::new();
    for sql in [
        "SELECT candidate_json FROM associations WHERE track_key=?1 AND candidate_json IS NOT NULL",
        "SELECT candidate_json FROM lyrics_cache WHERE track_key=?1",
    ] {
        if let Ok(json) = conn.query_row(sql, [key], |row| row.get::<_, String>(0)) {
            if let Ok(mut value) = serde_json::from_str::<LyricsCandidate>(&json) {
                value.offset_ms = 0;
                candidates.push(value);
            }
        }
    }
    Ok(candidates)
}

fn pinned_candidate(db: &Path, track: &TrackMetadata) -> Result<Option<LyricsCandidate>, String> {
    let conn = Connection::open(db).map_err(|e| e.to_string())?;
    // The second key keeps preferences chosen before the stable song key was introduced.
    for key in [song_key(track), track_key(track)] {
        let row = conn.query_row(
            "SELECT candidate_json FROM associations WHERE track_key=?1 AND candidate_json IS NOT NULL",
            [&key],
            |row| row.get::<_, String>(0),
        );
        let Ok(json) = row else { continue };
        let Ok(mut candidate) = serde_json::from_str::<LyricsCandidate>(&json) else {
            continue;
        };
        if candidate.source == "local" {
            let Some(path) = candidate.source_url.as_ref().map(PathBuf::from) else {
                continue;
            };
            let Ok(metadata) = fs::metadata(&path) else {
                continue;
            };
            if validate_file(&path, &candidate.format, metadata.len()).is_err() {
                continue;
            }
            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };
            candidate.sync_type = if candidate.format == "ttml" && content.contains("<span") {
                "word".into()
            } else {
                "line".into()
            };
            candidate.content = content;
        } else if candidate.content.trim().is_empty() {
            continue;
        }
        candidate.offset_ms = 0;
        return Ok(Some(candidate));
    }
    Ok(None)
}

fn sync_quality(candidate: &LyricsCandidate) -> u8 {
    match candidate.sync_type.as_str() {
        "word" => 2,
        "line" => 1,
        _ => 0,
    }
}

fn consider_candidate(
    candidate: LyricsCandidate,
    fallback: &mut Option<LyricsCandidate>,
) -> Option<LyricsCandidate> {
    if sync_quality(&candidate) == 2 {
        return Some(candidate);
    }
    if fallback.as_ref().map_or(true, |current| {
        sync_quality(&candidate) > sync_quality(current)
    }) {
        *fallback = Some(candidate);
    }
    None
}
fn local_matches(db: &Path, track: &TrackMetadata) -> Result<Vec<LyricsCandidate>, String> {
    let conn = Connection::open(db).map_err(|e| e.to_string())?;
    let mut statement = conn
        .prepare("SELECT path,file_name,format FROM library WHERE parse_error IS NULL")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut matches = Vec::new();
    for row in rows.filter_map(Result::ok) {
        let stem = Path::new(&row.1)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(&row.1);
        let confidence = local_match_confidence(stem, track);
        if confidence <= 0.0 {
            continue;
        }
        let Ok(content) = fs::read_to_string(&row.0) else {
            continue;
        };
        matches.push(LyricsCandidate {
            id: hash(&row.0),
            title: track.title.clone(),
            artist: track.artist.clone(),
            album: track.album.clone(),
            duration_ms: track.duration_ms,
            sync_type: if row.2 == "ttml" && content.contains("<span") {
                "word".into()
            } else {
                "line".into()
            },
            format: row.2,
            content,
            translation: None,
            source: "local".into(),
            attribution: attribution(i18n::msg_with(
                "backend.lyrics.localCollectionFile",
                &[("file", row.1.clone())],
            )),
            attribution_links: Vec::new(),
            source_url: Some(row.0),
            confidence,
            offset_ms: 0,
        });
    }
    matches.sort_by(|a, b| {
        b.confidence
            .total_cmp(&a.confidence)
            .then_with(|| a.source_url.cmp(&b.source_url))
    });
    Ok(matches)
}

fn local_match_confidence(file_stem: &str, track: &TrackMetadata) -> f32 {
    let name = normalize(file_stem);
    let title = normalize(&track.title);
    let artist = normalize(&track.artist);
    if title.is_empty() || name.is_empty() {
        return 0.0;
    }
    let artist_title = normalize(&format!("{} {}", track.artist, track.title));
    let title_artist = normalize(&format!("{} {}", track.title, track.artist));
    let mut score: f32 = if name == artist_title || name == title_artist {
        0.99
    } else if !artist.is_empty() && name.contains(&artist) && name.contains(&title) {
        0.97
    } else if name == title {
        0.94
    } else if name.contains(&title) {
        0.88
    } else {
        let name_tokens = name.split_whitespace().collect::<HashSet<_>>();
        let title_tokens = title.split_whitespace().collect::<Vec<_>>();
        if title_tokens.len() > 1 && title_tokens.iter().all(|token| name_tokens.contains(token)) {
            0.82
        } else {
            0.0
        }
    };
    if score > 0.0 {
        if let Some(album) = track.album.as_deref() {
            if !normalize(album).is_empty() && name.contains(&normalize(album)) {
                score += 0.005;
            }
        }
    }
    score.min(1.0)
}

async fn unison(
    client: &reqwest::Client,
    track: &TrackMetadata,
) -> Result<Option<LyricsCandidate>, String> {
    let response = client
        .get("https://unison.boidu.dev/lyrics/search")
        .query(&[
            ("song", track.title.as_str()),
            ("artist", track.artist.as_str()),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let response: Value = response
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;
    Ok(unison_candidate(track, &response))
}

fn unison_candidate(track: &TrackMetadata, response: &Value) -> Option<LyricsCandidate> {
    if response.get("success").and_then(Value::as_bool) == Some(false) {
        return None;
    }
    let data = response.get("data")?;
    let item = match data {
        Value::Array(items) => items.iter().find(|item| {
            item.get("lyrics")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty())
        })?,
        Value::Object(_) => data,
        _ => return None,
    };
    let content = item.get("lyrics")?.as_str()?.trim();
    if content.is_empty() {
        return None;
    }
    let format = item
        .get("format")
        .and_then(Value::as_str)
        .map(str::to_ascii_lowercase)
        .unwrap_or_else(|| {
            if content.trim_start().starts_with("<tt") {
                "ttml".into()
            } else if content.contains('[') {
                "lrc".into()
            } else {
                "text".into()
            }
        });
    let format = match format.as_str() {
        "ttml" => "ttml",
        "lrc" => "lrc",
        "plain" | "text" => "text",
        _ => return None,
    };
    let sync = match format {
        "ttml" => "word",
        "lrc" => "line",
        _ => "static",
    };
    let id = item.get("id")?.to_string().trim_matches('"').to_string();
    if id.is_empty() {
        return None;
    }
    let confidence = item
        .get("matchScore")
        .and_then(Value::as_f64)
        .map(|score| (0.7 + score.clamp(0.0, 1.0) as f32 * 0.25).min(0.95))
        .unwrap_or_else(|| match item.get("confidence").and_then(Value::as_str) {
            Some("high") => 0.92,
            Some("medium") => 0.82,
            Some("low") => 0.7,
            _ => 0.78,
        });
    let video_id = item.get("videoId").and_then(Value::as_str);
    let mut result = candidate(
        track,
        CandidateSpec {
            id: format!("unison:{id}"),
            sync,
            format,
            content: content.to_string(),
            source: "unison",
            attribution: "Lyrics from Unison (https://unison.boidu.dev)".into(),
            source_url: video_id.map(|value| format!("https://unison.boidu.dev/lyrics?v={value}")),
            confidence,
        },
    );
    result.title = item
        .get("song")
        .and_then(Value::as_str)
        .unwrap_or(&track.title)
        .to_string();
    result.artist = item
        .get("artist")
        .and_then(Value::as_str)
        .unwrap_or(&track.artist)
        .to_string();
    result.album = item
        .get("album")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| track.album.clone());
    result.duration_ms = item
        .get("duration")
        .and_then(Value::as_f64)
        .map(|seconds| (seconds * 1000.0) as u64)
        .or_else(|| {
            item.get("duration")
                .and_then(Value::as_u64)
                .map(|seconds| seconds * 1000)
        })
        .or(track.duration_ms);
    Some(result)
}

async fn lrclib(
    client: &reqwest::Client,
    track: &TrackMetadata,
) -> Result<Option<LyricsCandidate>, String> {
    let mut query = vec![
        ("track_name", track.title.clone()),
        ("artist_name", track.artist.clone()),
        ("album_name", track.album.clone().unwrap_or_default()),
    ];
    if let Some(duration_ms) = track.duration_ms {
        query.push(("duration", (duration_ms as f64 / 1000.0).to_string()));
    }
    let response = client
        .get("https://lrclib.net/api/get")
        .query(&query)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let item = if response.status() == reqwest::StatusCode::NOT_FOUND {
        let matches: Vec<LrclibItem> = client
            .get("https://lrclib.net/api/search")
            .query(&query)
            .send()
            .await
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| error.to_string())?
            .json()
            .await
            .map_err(|error| error.to_string())?;
        matches.into_iter().next()
    } else {
        Some(
            response
                .error_for_status()
                .map_err(|error| error.to_string())?
                .json()
                .await
                .map_err(|error| error.to_string())?,
        )
    };
    Ok(item.and_then(|item| lrclib_candidate(track, item)))
}

fn lrclib_candidate(track: &TrackMetadata, item: LrclibItem) -> Option<LyricsCandidate> {
    let (sync, format, content) = if let Some(value) = item.synced_lyrics {
        ("line", "lrc", value)
    } else {
        let value = item.plain_lyrics?;
        ("static", "text", value)
    };
    let mut result = candidate(
        track,
        CandidateSpec {
            id: format!("lrclib:{}", item.id),
            sync,
            format,
            content,
            source: "lrclib",
            attribution: attribution("LRCLIB".into()),
            source_url: Some(format!("https://lrclib.net/api/get/{}", item.id)),
            confidence: 0.8,
        },
    );
    result.title = item.track_name;
    result.artist = item.artist_name;
    result.album = item.album_name;
    result.duration_ms = item.duration.map(|value| (value * 1000.0) as u64);
    Some(result)
}
struct CandidateSpec<'a> {
    id: String,
    sync: &'a str,
    format: &'a str,
    content: String,
    source: &'a str,
    attribution: String,
    source_url: Option<String>,
    confidence: f32,
}
/// "Lyrics: {source}" as a message descriptor; `source` is a name or a descriptor.
pub fn attribution(source: String) -> String {
    i18n::msg_with("backend.lyrics.attribution", &[("source", source)])
}
fn candidate(track: &TrackMetadata, spec: CandidateSpec<'_>) -> LyricsCandidate {
    LyricsCandidate {
        id: spec.id,
        title: track.title.clone(),
        artist: track.artist.clone(),
        album: track.album.clone(),
        duration_ms: track.duration_ms,
        sync_type: spec.sync.into(),
        format: spec.format.into(),
        content: spec.content,
        translation: None,
        source: spec.source.into(),
        attribution: spec.attribution,
        attribution_links: Vec::new(),
        source_url: spec.source_url,
        confidence: spec.confidence,
        offset_ms: 0,
    }
}
fn cache(db: &Path, key: &str, candidate: &LyricsCandidate) -> Result<(), String> {
    Connection::open(db).map_err(|e| e.to_string())?.execute("INSERT INTO lyrics_cache(track_key,candidate_json) VALUES(?1,?2) ON CONFLICT(track_key) DO UPDATE SET candidate_json=excluded.candidate_json,created_at=unixepoch()", params![key, serde_json::to_string(candidate).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn clear_cache(db: &Path) -> Result<(), String> {
    Connection::open(db)
        .map_err(|e| e.to_string())?
        .execute("DELETE FROM lyrics_cache", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn track_key(track: &TrackMetadata) -> String {
    hash(&format!(
        "{}|{}|{}",
        normalize(&track.title),
        normalize(&track.artist),
        track.duration_ms.unwrap_or(0) / 2000
    ))
}
fn song_key(track: &TrackMetadata) -> String {
    hash(&format!(
        "{}|{}",
        normalize(&track.title),
        normalize(&track.artist)
    ))
}
fn normalize(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn sample_track() -> TrackMetadata {
        TrackMetadata {
            title: "Luz de invierno".into(),
            artist: "Mar Abierta".into(),
            album: Some("Horizonte".into()),
            duration_ms: Some(180000),
            cover_data_url: None,
            is_demo: false,
        }
    }

    #[test]
    fn track_keys_ignore_case_and_punctuation() {
        let a = TrackMetadata {
            title: "Hello!".into(),
            artist: "Artist".into(),
            album: None,
            duration_ms: Some(100000),
            cover_data_url: None,
            is_demo: false,
        };
        let b = TrackMetadata {
            title: "hello".into(),
            artist: "ARTIST".into(),
            album: None,
            duration_ms: Some(100500),
            cover_data_url: None,
            is_demo: false,
        };
        assert_eq!(track_key(&a), track_key(&b));
    }

    #[test]
    fn local_matching_keeps_multiple_named_variants() {
        let track = sample_track();
        assert!(local_match_confidence("Mar Abierta - Luz de invierno", &track) >= 0.97);
        assert!(local_match_confidence("Luz de invierno (dueto)", &track) >= 0.88);
        assert_eq!(local_match_confidence("Otra canción", &track), 0.0);
    }

    #[test]
    fn removed_entry_stays_excluded_without_deleting_the_file() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("uxnow-lyrics-{suffix}"));
        fs::create_dir_all(&root).expect("temp folder");
        let first = root.join("Mar Abierta - Luz de invierno.lrc");
        let second = root.join("Luz de invierno (dueto).lrc");
        fs::write(&first, "[00:00.00]Primera versión").expect("first lyric");
        fs::write(&second, "[00:00.00]Segunda versión").expect("second lyric");
        let db = root.join("lyrics.db");
        init_db(&db).expect("database");

        let entries = index_library(&db, &[root.to_string_lossy().into_owned()]).expect("index");
        assert_eq!(entries.len(), 2);
        assert_eq!(
            local_matches(&db, &sample_track()).expect("matches").len(),
            2
        );

        let removed_path = PathBuf::from(&entries[0].path);
        remove_library_entry(&db, entries[0].id).expect("remove entry");
        let entries = index_library(&db, &[root.to_string_lossy().into_owned()]).expect("reindex");
        assert_eq!(entries.len(), 1);
        assert!(removed_path.exists());

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[tokio::test]
    async fn chosen_file_or_provider_survives_song_changes_and_cache_clearing() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("uxnow-preference-{suffix}"));
        fs::create_dir_all(&root).expect("temp folder");
        let first = root.join("Mar Abierta - Luz de invierno.ttml");
        let second = root.join("Luz de invierno (dueto).ttml");
        let ttml = "<tt><body><p begin=\"0\" end=\"2\"><span begin=\"0\" end=\"2\">Hola</span></p></body></tt>";
        fs::write(&first, ttml).expect("first lyric");
        fs::write(&second, ttml).expect("second lyric");
        let db = root.join("lyrics.db");
        init_db(&db).expect("database");
        index_library(&db, &[root.to_string_lossy().into_owned()]).expect("index");
        let track = sample_track();
        let candidates = local_matches(&db, &track).expect("local matches");
        assert_eq!(candidates.len(), 2);
        let chosen = candidates[1].clone();
        pin_candidate(&db, &track, &chosen).expect("pin local file");
        let mut restarted = track.clone();
        restarted.duration_ms = None;
        let resolved = resolve(db.clone(), AppConfig::default(), restarted.clone(), None)
            .await
            .expect("resolve")
            .expect("chosen local file");
        assert_eq!(resolved.id, chosen.id);

        let mut spicy = candidate_for_test("spicylyrics:track", "spicylyrics", "static");
        spicy.format = "spicy".into();
        spicy.content = "{\"Content\":[{\"Text\":\"Hola\"}]}".into();
        pin_candidate(&db, &track, &spicy).expect("pin provider");
        let mut legacy = spicy.clone();
        legacy.offset_ms = 450;
        Connection::open(&db)
            .expect("database")
            .execute(
                "UPDATE associations SET candidate_json=?1,offset_ms=450 WHERE track_key=?2",
                params![
                    serde_json::to_string(&legacy).expect("legacy candidate"),
                    song_key(&track)
                ],
            )
            .expect("legacy association");
        Connection::open(&db)
            .expect("database")
            .execute(
                "INSERT INTO lyric_offsets(track_key,candidate_id,offset_ms) VALUES(?1,?2,450)",
                params![song_key(&track), spicy.id],
            )
            .expect("legacy offset");
        clear_cache(&db).expect("clear ordinary cache");
        let resolved = resolve(db.clone(), AppConfig::default(), restarted, None)
            .await
            .expect("resolve")
            .expect("chosen provider");
        assert_eq!(resolved.id, spicy.id);
        assert_eq!(resolved.offset_ms, 0);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn maps_unison_ttml_with_required_attribution() {
        let response = serde_json::json!({
            "success": true,
            "data": {
                "id": 42,
                "song": "Luz de invierno",
                "artist": "Mar Abierta",
                "album": "Horizonte",
                "duration": 180,
                "lyrics": "<tt><body><p>Hola</p></body></tt>",
                "format": "ttml",
                "syncType": "richsync",
                "confidence": "high"
            }
        });
        let candidate = unison_candidate(&sample_track(), &response).expect("candidate");
        assert_eq!(candidate.format, "ttml");
        assert_eq!(candidate.sync_type, "word");
        assert_eq!(candidate.confidence, 0.92);
        assert_eq!(
            candidate.attribution,
            "Lyrics from Unison (https://unison.boidu.dev)"
        );
    }
    fn candidate_for_test(id: &str, source: &str, sync_type: &str) -> LyricsCandidate {
        LyricsCandidate {
            id: id.into(),
            title: "Luz de invierno".into(),
            artist: "Mar Abierta".into(),
            album: Some("Horizonte".into()),
            duration_ms: Some(180_000),
            sync_type: sync_type.into(),
            format: if sync_type == "word" { "ttml" } else { "lrc" }.into(),
            content: "letra".into(),
            translation: None,
            source: source.into(),
            attribution: source.into(),
            attribution_links: Vec::new(),
            source_url: None,
            confidence: 0.9,
            offset_ms: 0,
        }
    }

    #[test]
    fn word_sync_overrides_an_earlier_line_candidate() {
        let mut fallback = None;
        assert!(consider_candidate(
            candidate_for_test("local-line", "local", "line"),
            &mut fallback,
        )
        .is_none());

        let selected = consider_candidate(
            candidate_for_test("binimum-word", "binimum", "word"),
            &mut fallback,
        )
        .expect("word candidate");
        assert_eq!(selected.id, "binimum-word");
    }

    #[test]
    fn source_order_breaks_ties_between_word_candidates() {
        let mut candidates = [
            candidate_for_test("local-word", "local", "word"),
            candidate_for_test("binimum-word", "binimum", "word"),
            candidate_for_test("unison-word", "unison", "word"),
        ];
        candidates.sort_by_key(|candidate| std::cmp::Reverse(sync_quality(candidate)));
        assert_eq!(
            candidates
                .iter()
                .map(|candidate| candidate.id.as_str())
                .collect::<Vec<_>>(),
            ["local-word", "binimum-word", "unison-word"]
        );
    }
    #[test]
    fn deserializes_lrclib_camel_case_response() {
        let item: LrclibItem = serde_json::from_value(serde_json::json!({
            "id": 27,
            "trackName": "Luz de invierno",
            "artistName": "Mar Abierta",
            "albumName": "Horizonte",
            "duration": 180.0,
            "syncedLyrics": "[00:00.00]Hola",
            "plainLyrics": "Hola"
        }))
        .expect("LRCLIB uses camelCase fields");
        let candidate = lrclib_candidate(&sample_track(), item).expect("candidate");
        assert_eq!(candidate.format, "lrc");
        assert_eq!(candidate.attribution, attribution("LRCLIB".into()));
    }
}
