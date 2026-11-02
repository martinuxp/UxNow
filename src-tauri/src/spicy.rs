use crate::{
    lyrics::{AttributionLink, LyricsCandidate},
    metadata::TrackMetadata,
    spotify::SPICYLYRICS_PUBLISHABLE_KEY,
};
use reqwest::{Client, StatusCode};
use serde_json::Value;

/// SpicyLyrics is keyed by Spotify track ID. A linked Spotify account finds the
/// ID through Spotify search; without one, ListenBrainz resolves it from metadata.
pub async fn find(
    client: &Client,
    track: &TrackMetadata,
    spotify_token: Option<&str>,
) -> Result<Option<LyricsCandidate>, String> {
    let mut track_ids = Vec::new();
    let mut spotify_error = None;
    if let Some(token) = spotify_token {
        match spotify_search(client, track, token).await {
            Ok(id) => track_ids.extend(id),
            Err(error) => spotify_error = Some(error),
        }
    }
    let from_metadata = track_ids.is_empty();
    if from_metadata {
        track_ids = crate::listenbrainz::spotify_ids(client, track).await?;
        if track_ids.is_empty() {
            return spotify_error.map_or(Ok(None), Err);
        }
    }
    for track_id in &track_ids {
        if let Some(mut candidate) = lyrics_for(client, track, track_id).await? {
            if from_metadata {
                candidate.confidence = 0.9;
            }
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}

async fn spotify_search(
    client: &Client,
    track: &TrackMetadata,
    spotify_token: &str,
) -> Result<Option<String>, String> {
    let query = format!("track:{} artist:{}", track.title, track.artist);
    let search: Value = client
        .get("https://api.spotify.com/v1/search")
        .bearer_auth(spotify_token)
        .query(&[("q", query.as_str()), ("type", "track"), ("limit", "10")])
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| format!("Spotify: {error}"))?
        .json()
        .await
        .map_err(|error| error.to_string())?;
    Ok(best_spotify_track(&search, track))
}

async fn lyrics_for(
    client: &Client,
    track: &TrackMetadata,
    track_id: &str,
) -> Result<Option<LyricsCandidate>, String> {
    let mut response = None;
    for attempt in 0..3 {
        let result = client
            .get(format!("https://api.spicylyrics.org/v1/lyrics/{track_id}"))
            .bearer_auth(SPICYLYRICS_PUBLISHABLE_KEY)
            .send()
            .await
            .map_err(|error| format!("SpicyLyrics: {error}"))?;
        let retry = result.status() == StatusCode::SERVICE_UNAVAILABLE && attempt < 2;
        response = Some(result);
        if !retry {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200 * (attempt + 1))).await;
    }
    let response = response.ok_or_else(|| crate::i18n::msg("backend.spicy.noResponse"))?;
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if response.status() == StatusCode::SERVICE_UNAVAILABLE {
        return Err(crate::i18n::msg("backend.spicy.unavailable"));
    }
    if matches!(
        response.status(),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
    ) {
        return Err(crate::i18n::msg("backend.spicy.keyRejected"));
    }
    let response: Value = response
        .error_for_status()
        .map_err(|error| format!("SpicyLyrics: {error}"))?
        .json()
        .await
        .map_err(|error| format!("SpicyLyrics: {error}"))?;
    Ok(candidate_from_response(track, track_id, &response))
}

fn best_spotify_track(search: &Value, track: &TrackMetadata) -> Option<String> {
    let title = normalize(&track.title);
    let artist = normalize(&track.artist);
    search
        .pointer("/tracks/items")?
        .as_array()?
        .iter()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?;
            let item_title = normalize(item.get("name")?.as_str()?);
            let item_artists = item.get("artists")?.as_array()?;
            let artist_match = item_artists.iter().any(|value| {
                value
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| normalize(name) == artist)
            });
            if !artist_match || item_title != title {
                return None;
            }
            let mut score = 1_i64;
            if let (Some(expected), Some(actual)) = (
                track.duration_ms,
                item.get("duration_ms").and_then(Value::as_u64),
            ) {
                let difference = expected.abs_diff(actual);
                if difference > 15_000 {
                    return None;
                }
                score += 15_000_i64.saturating_sub(difference as i64);
            }
            if track.album.as_ref().is_some_and(|album| {
                item.pointer("/album/name")
                    .and_then(Value::as_str)
                    .is_some_and(|value| normalize(value) == normalize(album))
            }) {
                score += 20_000
            }
            Some((score, id.to_string()))
        })
        .max_by_key(|(score, _)| *score)
        .map(|(_, id)| id)
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_alphanumeric() || character.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn candidate_from_response(
    track: &TrackMetadata,
    track_id: &str,
    response: &Value,
) -> Option<LyricsCandidate> {
    let body = response.get("Body")?;
    let content = body.get("Content")?.as_array()?;
    if content.is_empty() {
        return None;
    }
    let sync_type = match body.get("Type")?.as_str()? {
        "Syllable" => "word",
        "Line" => "line",
        "Static" => "static",
        _ => return None,
    };
    let provider = match body.get("source").and_then(Value::as_str)? {
        "spicy_lyrics" => "SpicyLyrics",
        "apple_music" => "Apple Music",
        "spotify" => "Spotify",
        _ => return None,
    };
    let attribution_links = if provider == "SpicyLyrics" {
        ["Uploader", "Maker"]
            .iter()
            .filter_map(|role| {
                let person = body.get("UploadAttribution")?.get(*role)?;
                let url = person.get("url")?.as_str()?;
                if !url.starts_with("https://spicylyrics.org/") {
                    return None;
                }
                Some(AttributionLink {
                    label: crate::i18n::msg_with(
                        if *role == "Uploader" {
                            "backend.spicy.uploader"
                        } else {
                            "backend.spicy.maker"
                        },
                        &[("user", person.get("username")?.as_str()?.to_string())],
                    ),
                    url: url.to_string(),
                })
            })
            .collect()
    } else {
        Vec::new()
    };
    Some(LyricsCandidate {
        id: format!("spicylyrics:{track_id}"),
        title: track.title.clone(),
        artist: track.artist.clone(),
        album: track.album.clone(),
        duration_ms: track.duration_ms,
        sync_type: sync_type.into(),
        format: "spicy".into(),
        content: body.to_string(),
        translation: None,
        source: "spicylyrics".into(),
        attribution: crate::lyrics::attribution(provider.into()),
        attribution_links,
        source_url: Some(format!("https://open.spotify.com/track/{track_id}")),
        confidence: 0.95,
        offset_ms: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn track() -> TrackMetadata {
        TrackMetadata {
            title: "el mundo y yo".into(),
            artist: "AKRIILA".into(),
            album: Some("lucy miró al mundo y notó que está girando".into()),
            duration_ms: Some(207_000),
            cover_data_url: None,
            is_demo: false,
        }
    }
    #[test]
    #[ignore]
    fn temp_live_lookup_without_spotify() {
        let client = Client::builder().user_agent("UxNow/0.1").build().expect("client");
        for (title, artist, album) in [
            ("Shallow", "Lady Gaga & Bradley Cooper", "A Star Is Born Soundtrack"),
            ("DtMF", "Bad Bunny", "DeBÍTIRAR MÁS FOTos"),
            ("el mundo y yo", "AKRIILA", "lucy miró al mundo y notó que está girando"),
        ] {
            let track = TrackMetadata {
                title: title.into(),
                artist: artist.into(),
                album: Some(album.into()),
                duration_ms: None,
                cover_data_url: None,
                is_demo: false,
            };
            let found = tauri::async_runtime::block_on(find(&client, &track, None));
            println!(
                "{title}: {:?}",
                found.map(|c| c.map(|c| (c.id, c.sync_type, c.attribution, c.confidence)))
            );
        }
    }
    #[test]
    fn spotify_search_rejects_wrong_artist_and_variant() {
        let search = serde_json::json!({"tracks":{"items":[
            {"id":"wrong", "name":"el mundo y yo", "artists":[{"name":"Otro"}]},
            {"id":"variant", "name":"el mundo y yo (live)", "artists":[{"name":"AKRIILA"}]},
            {"id":"2mxEi8MV8Y5IxTIEArxgDd", "name":"el mundo y yo", "artists":[{"name":"AKRIILA"}], "duration_ms":207000,"album":{"name":"lucy miró al mundo y notó que está girando"}}
        ]}});
        assert_eq!(
            best_spotify_track(&search, &track()).as_deref(),
            Some("2mxEi8MV8Y5IxTIEArxgDd")
        );
    }
    #[test]
    fn parses_community_word_sync_and_required_credits() {
        let response = serde_json::json!({"Body":{"Type":"Syllable","source":"spicy_lyrics","Content":[{"Type":"Vocal","Lead":{"Syllables":[{"Text":"Hola","StartTime":1.0,"EndTime":1.4}]}}],"UploadAttribution":{"Uploader":{"username":"uno","url":"https://spicylyrics.org/uid/1"},"Maker":{"username":"dos","url":"https://spicylyrics.org/uid/2"}}}});
        let candidate = candidate_from_response(&track(), "2mxEi8MV8Y5IxTIEArxgDd", &response)
            .expect("candidate");
        assert_eq!(candidate.sync_type, "word");
        assert_eq!(candidate.format, "spicy");
        assert_eq!(candidate.attribution_links.len(), 2);
        let mut incomplete = response;
        incomplete["Body"]["UploadAttribution"]["Maker"] = Value::Null;
        let candidate =
            candidate_from_response(&track(), "id", &incomplete).expect("available credit");
        assert_eq!(candidate.attribution_links.len(), 1);
    }
}
