use crate::metadata::TrackMetadata;
use reqwest::Client;
use serde_json::{json, Value};

const LOOKUP_URL: &str = "https://labs.api.listenbrainz.org/spotify-id-from-metadata/json";
const MAX_IDS: usize = 3;

/// Spotify track IDs for a track, resolved from its metadata by ListenBrainz
/// without a Spotify account. The most specific lookups come first.
pub async fn spotify_ids(client: &Client, track: &TrackMetadata) -> Result<Vec<String>, String> {
    let response: Value = client
        .post(LOOKUP_URL)
        .json(&lookups(track))
        .send()
        .await
        .map_err(|error| format!("ListenBrainz: {error}"))?
        .error_for_status()
        .map_err(|error| format!("ListenBrainz: {error}"))?
        .json()
        .await
        .map_err(|error| format!("ListenBrainz: {error}"))?;
    Ok(ids_from_response(&response))
}

/// AirPlay senders report the full artist credit ("A & B"), which is what
/// ListenBrainz indexes best; the album and lead artist are fallbacks.
fn lookups(track: &TrackMetadata) -> Value {
    let album = track.album.clone().unwrap_or_default();
    let lead = lead_artist(&track.artist);
    let mut queries = vec![(track.artist.as_str(), album.as_str())];
    if !album.is_empty() {
        queries.push((track.artist.as_str(), ""));
    }
    if lead != track.artist {
        queries.push((lead, album.as_str()));
    }
    Value::Array(
        queries
            .into_iter()
            .map(|(artist, release)| {
                json!({
                    "artist_name": artist,
                    "track_name": track.title,
                    "release_name": release,
                })
            })
            .collect(),
    )
}

fn lead_artist(artist: &str) -> &str {
    [" & ", ", ", " feat. ", " ft. ", " x "]
        .iter()
        .filter_map(|separator| artist.find(separator))
        .min()
        .map_or(artist, |index| artist[..index].trim())
}

fn ids_from_response(response: &Value) -> Vec<String> {
    let mut ids = Vec::new();
    for id in response
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("spotify_track_ids")?.as_array())
        .flatten()
        .filter_map(Value::as_str)
    {
        if is_spotify_id(id) && !ids.iter().any(|known| known == id) {
            ids.push(id.to_string());
        }
    }
    ids.truncate(MAX_IDS);
    ids
}

fn is_spotify_id(id: &str) -> bool {
    id.len() == 22
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(artist: &str, album: Option<&str>) -> TrackMetadata {
        TrackMetadata {
            title: "Shallow".into(),
            artist: artist.into(),
            album: album.map(Into::into),
            duration_ms: Some(215_000),
            cover_data_url: None,
            is_demo: false,
        }
    }

    #[test]
    fn lookups_try_full_credit_then_without_album_then_lead_artist() {
        let queries = lookups(&track(
            "Lady Gaga & Bradley Cooper",
            Some("A Star Is Born Soundtrack"),
        ));
        let pairs: Vec<_> = queries
            .as_array()
            .expect("array")
            .iter()
            .map(|query| {
                (
                    query["artist_name"].as_str().expect("artist"),
                    query["release_name"].as_str().expect("release"),
                )
            })
            .collect();
        assert_eq!(
            pairs,
            [
                ("Lady Gaga & Bradley Cooper", "A Star Is Born Soundtrack"),
                ("Lady Gaga & Bradley Cooper", ""),
                ("Lady Gaga", "A Star Is Born Soundtrack"),
            ]
        );
        assert_eq!(
            lookups(&track("AKRIILA", None)).as_array().map(Vec::len),
            Some(1)
        );
    }

    #[test]
    fn ids_keep_lookup_order_without_duplicates_or_invalid_values() {
        let response = json!([
            {"spotify_track_ids": ["2VxeLyX666F8uXCJ0dZF8B", "not-an-id"]},
            {"spotify_track_ids": ["2VxeLyX666F8uXCJ0dZF8B", "31TXxq8gfgYyrYClnYY48m"]},
            {"spotify_track_ids": []},
            {"spotify_track_ids": ["53iuhJlwXhSER5J2IYYv1W", "35ttE4t8lQZA2vuCYDg4G7"]}
        ]);
        assert_eq!(
            ids_from_response(&response),
            [
                "2VxeLyX666F8uXCJ0dZF8B",
                "31TXxq8gfgYyrYClnYY48m",
                "53iuhJlwXhSER5J2IYYv1W"
            ]
        );
    }
}
