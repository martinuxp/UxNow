use crate::{lyrics::LyricsCandidate, metadata::TrackMetadata};
use reqwest::{Client, StatusCode, Url};
use serde::Deserialize;
use std::collections::HashSet;

const API_URL: &str = "https://lyrics-api.binimum.org/";
const STORAGE_HOST: &str = "lyrics-storage.binimum.org";
const MAX_TTML_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    results: Vec<SearchResult>,
}

#[derive(Debug, Deserialize)]
struct SearchResult {
    id: String,
    track_name: String,
    artist_name: String,
    album_name: Option<String>,
    duration: Option<f64>,
    isrc: Option<String>,
    timing_type: Option<String>,
    #[serde(rename = "lyricsUrl")]
    lyrics_url: String,
}

pub async fn find(
    client: &Client,
    track: &TrackMetadata,
) -> Result<Option<LyricsCandidate>, String> {
    let mut query = vec![
        ("track", track.title.clone()),
        ("artist", track.artist.clone()),
    ];
    if let Some(album) = track
        .album
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        query.push(("album", album.clone()));
    }
    if let Some(duration_ms) = track.duration_ms {
        query.push((
            "duration",
            (duration_ms as f64 / 1000.0).round().to_string(),
        ));
    }

    let response = client
        .get(API_URL)
        .query(&query)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "BiniLyrics no respondió dentro del tiempo límite".to_string()
            } else {
                "No se pudo conectar con BiniLyrics".to_string()
            }
        })?;
    if response.status() == StatusCode::NO_CONTENT {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!(
            "BiniLyrics respondió HTTP {}",
            response.status().as_u16()
        ));
    }
    let response: SearchResponse = response
        .json()
        .await
        .map_err(|_| "BiniLyrics devolvió una respuesta JSON inválida".to_string())?;
    let Some((result, confidence)) = best_match(track, response.results) else {
        return Ok(None);
    };

    let lyrics_url = Url::parse(&result.lyrics_url)
        .map_err(|_| "BiniLyrics devolvió una URL de letra inválida".to_string())?;
    if lyrics_url.scheme() != "https" || lyrics_url.host_str() != Some(STORAGE_HOST) {
        return Err("BiniLyrics devolvió un origen de letra no permitido".into());
    }

    let lyrics_response = client
        .get(lyrics_url.clone())
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    if lyrics_response
        .content_length()
        .is_some_and(|size| size > MAX_TTML_BYTES as u64)
    {
        return Err("La letra de BiniLyrics supera el límite de 2 MB".into());
    }
    let bytes = lyrics_response
        .bytes()
        .await
        .map_err(|error| error.to_string())?;
    if bytes.len() > MAX_TTML_BYTES {
        return Err("La letra de BiniLyrics supera el límite de 2 MB".into());
    }
    let content = String::from_utf8(bytes.to_vec())
        .map_err(|_| "BiniLyrics devolvió una letra que no es UTF-8".to_string())?;
    if !content.trim_start().starts_with("<tt") || !content.contains("</tt>") {
        return Err("BiniLyrics devolvió un TTML incompleto".into());
    }

    let sync_type = match result.timing_type.as_deref() {
        Some("word") => "word",
        Some("line") => "line",
        _ if content.contains("itunes:timing=\"Word\"") => "word",
        _ => "line",
    };

    Ok(Some(LyricsCandidate {
        id: format!("binimum:{}", result.isrc.as_deref().unwrap_or(&result.id)),
        title: result.track_name,
        artist: result.artist_name,
        album: result.album_name.or_else(|| track.album.clone()),
        duration_ms: result
            .duration
            .map(|seconds| (seconds * 1000.0).round() as u64)
            .or(track.duration_ms),
        sync_type: sync_type.into(),
        format: "ttml".into(),
        content,
        translation: None,
        source: "binimum".into(),
        attribution: "Letras: BiniLyrics · lyrics.binimum.org".into(),
        attribution_links: Vec::new(),
        source_url: Some(lyrics_url.to_string()),
        confidence,
        offset_ms: 0,
    }))
}

pub async fn diagnose() -> (bool, String) {
    let client = match Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .user_agent("UxNow/0.1 diagnostics")
        .build()
    {
        Ok(client) => client,
        Err(_) => return (false, "No se pudo preparar la conexión".into()),
    };

    match client
        .get(API_URL)
        .query(&[("q", "UxNow availability check")])
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {
            match response.json::<SearchResponse>().await {
                Ok(_) => (true, "API disponible".into()),
                Err(_) => (false, "El API respondió con un formato inesperado".into()),
            }
        }
        Ok(response) => (
            false,
            format!(
                "HTTP {} en lyrics-api.binimum.org",
                response.status().as_u16()
            ),
        ),
        Err(error) if error.is_timeout() => (false, "El API no respondió en 6 segundos".into()),
        Err(_) => (
            false,
            "No se pudo conectar con lyrics-api.binimum.org".into(),
        ),
    }
}
fn best_match(track: &TrackMetadata, results: Vec<SearchResult>) -> Option<(SearchResult, f32)> {
    results
        .into_iter()
        .filter_map(|result| {
            let mut score = similarity(&result.track_name, &track.title) * 0.58
                + similarity(&result.artist_name, &track.artist) * 0.34;
            if let (Some(expected), Some(actual)) =
                (track.album.as_deref(), result.album_name.as_deref())
            {
                score += similarity(actual, expected) * 0.08;
            } else {
                score += 0.04;
            }
            if let (Some(expected), Some(actual)) = (track.duration_ms, result.duration) {
                let actual = (actual * 1000.0).round() as u64;
                let delta = expected.abs_diff(actual);
                if delta <= 3_000 {
                    score = (score + 0.04).min(1.0);
                } else if delta > 20_000 {
                    score -= 0.12;
                }
            }
            (score >= 0.62).then_some((result, score.clamp(0.0, 0.99)))
        })
        .max_by(|(_, left), (_, right)| left.total_cmp(right))
}

fn similarity(left: &str, right: &str) -> f32 {
    let left = normalize(left);
    let right = normalize(right);
    if left == right {
        return 1.0;
    }
    if left.contains(&right) || right.contains(&left) {
        return 0.88;
    }
    let left_words = left.split_whitespace().collect::<HashSet<_>>();
    let right_words = right.split_whitespace().collect::<HashSet<_>>();
    if left_words.is_empty() || right_words.is_empty() {
        return 0.0;
    }
    let overlap = left_words.intersection(&right_words).count() as f32;
    overlap / left_words.len().max(right_words.len()) as f32
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn track() -> TrackMetadata {
        TrackMetadata {
            title: "Running Up That Hill (A Deal With God)".into(),
            artist: "Kate Bush".into(),
            album: Some("Hounds of Love".into()),
            duration_ms: Some(299_000),
            cover_data_url: None,
            is_demo: false,
        }
    }

    #[test]
    fn parses_documented_response_and_selects_exact_match() {
        let response: SearchResponse = serde_json::from_value(json!({
            "total": 1,
            "source": "HIT-EXACT",
            "results": [{
                "id": "69ba10220024b66837bc",
                "track_name": "Running Up That Hill (A Deal With God)",
                "artist_name": "Kate Bush",
                "album_name": "Hounds of Love",
                "duration": 299,
                "isrc": "GBCNR8500002",
                "timing_type": "word",
                "lyricsUrl": "https://lyrics-storage.binimum.org/GBCNR8500002.ttml"
            }]
        }))
        .expect("documented response");
        let (result, confidence) = best_match(&track(), response.results).expect("exact match");
        assert_eq!(result.isrc.as_deref(), Some("GBCNR8500002"));
        assert_eq!(result.timing_type.as_deref(), Some("word"));
        assert!(confidence > 0.95);
    }

    #[test]
    fn rejects_unrelated_results() {
        let response: SearchResponse = serde_json::from_value(json!({
            "results": [{
                "id": "other",
                "track_name": "Different Song",
                "artist_name": "Different Artist",
                "album_name": "Other",
                "duration": 120,
                "timing_type": "line",
                "lyricsUrl": "https://lyrics-storage.binimum.org/other.ttml"
            }]
        }))
        .expect("response");
        assert!(best_match(&track(), response.results).is_none());
    }
}
