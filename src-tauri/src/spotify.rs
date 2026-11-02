use crate::i18n;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use getrandom::fill as random_fill;
use keyring::Entry;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

pub const SPOTIFY_CLIENT_ID: &str = "733c0019e54f49668632210984d12112";
pub const SPICYLYRICS_PUBLISHABLE_KEY: &str = "sl_pk_kvtfk4SWsEJ2yCSe6Qg8DgEcJrOu7VL962RARhyNoBI";
const CALLBACK: &str = "http://127.0.0.1:17846/callback";
const KEYRING_SERVICE: &str = "UxNow";
const KEYRING_USER: &str = "spotify-refresh-token";

#[derive(Debug)]
pub struct Session {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_at: Option<Instant>,
    linking: bool,
    refresh_lock: Arc<tokio::sync::Mutex<()>>,
}

impl Default for Session {
    fn default() -> Self {
        Self {
            access_token: None,
            refresh_token: load_refresh_token().ok().flatten(),
            expires_at: None,
            linking: false,
            refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkStatus {
    pub connected: bool,
    pub linking: bool,
    /// Message descriptor (see `i18n`).
    pub message: String,
}

/// Text of the page the browser shows after the Spotify redirect, in the UI language.
pub struct CallbackPages {
    pub linked: String,
    pub mismatch: String,
}

pub type SharedSession = Arc<Mutex<Session>>;

pub fn status(session: &SharedSession) -> LinkStatus {
    let mut session = session.lock().expect("spotify lock");
    let access_valid = session
        .expires_at
        .is_some_and(|expires_at| expires_at > Instant::now());
    if !access_valid {
        session.access_token = None;
        session.expires_at = None;
    }
    let connected = access_valid || session.refresh_token.is_some();
    LinkStatus {
        connected,
        linking: session.linking,
        message: i18n::msg(if connected {
            "backend.spotify.linked"
        } else if session.linking {
            "backend.spotify.waiting"
        } else {
            "backend.spotify.notLinked"
        }),
    }
}

pub fn start_link(
    app: AppHandle,
    session: SharedSession,
    pages: CallbackPages,
) -> Result<LinkStatus, String> {
    {
        let mut guard = session
            .lock()
            .map_err(|_| i18n::msg("backend.spotify.startFailed"))?;
        if guard.linking {
            drop(guard);
            return Ok(status(&session));
        }
        guard.linking = true;
    }
    let listener = match TcpListener::bind("127.0.0.1:17846") {
        Ok(listener) => listener,
        Err(_) => {
            if let Ok(mut guard) = session.lock() {
                guard.linking = false;
            }
            return Err(i18n::msg("backend.spotify.portInUse"));
        }
    };
    let verifier = verifier()?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_token(24)?;
    let auth_url = format!(
        "https://accounts.spotify.com/authorize?client_id={}&response_type=code&redirect_uri={}&code_challenge_method=S256&code_challenge={}&state={}",
        SPOTIFY_CLIENT_ID,
        encode(CALLBACK),
        encode(&challenge),
        encode(&state),
    );
    crate::native_process::command("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &auth_url])
        .spawn()
        .map_err(|error| {
            i18n::msg_with(
                "backend.spotify.openFailed",
                &[("error", error.to_string())],
            )
        })?;

    let callback_app = app.clone();
    let callback_session = session.clone();
    std::thread::spawn(move || {
        let result = receive_callback(listener, &state, &pages)
            .and_then(|code| tauri::async_runtime::block_on(exchange_code(&code, &verifier)))
            .and_then(|token| {
                let refresh_token = token
                    .refresh_token
                    .ok_or_else(|| i18n::msg("backend.spotify.noRefreshToken"))?;
                save_refresh_token(&refresh_token)?;
                let mut guard = callback_session.lock().expect("spotify lock");
                guard.access_token = Some(token.access_token);
                guard.refresh_token = Some(refresh_token);
                guard.expires_at =
                    Some(Instant::now() + Duration::from_secs(token.expires_in.saturating_sub(30)));
                guard.linking = false;
                Ok(())
            });
        if let Err(error) = result {
            if let Ok(mut guard) = callback_session.lock() {
                guard.linking = false;
            }
            let _ = callback_app.emit(
                "spotify://link-state",
                LinkStatus {
                    connected: false,
                    linking: false,
                    message: error,
                },
            );
        } else {
            let _ = callback_app.emit("spotify://link-state", status(&callback_session));
        }
    });
    let status = status(&session);
    let _ = app.emit("spotify://link-state", status.clone());
    Ok(status)
}

pub async fn access_token(session: &SharedSession) -> Result<Option<String>, String> {
    let refresh_lock = session
        .lock()
        .map_err(|_| i18n::msg("backend.spotify.accessFailed"))?
        .refresh_lock
        .clone();
    let _refresh_guard = refresh_lock.lock().await;
    let (access, refresh) = {
        let mut guard = session
            .lock()
            .map_err(|_| i18n::msg("backend.spotify.accessFailed"))?;
        if guard
            .expires_at
            .is_some_and(|expires_at| expires_at > Instant::now())
        {
            return Ok(guard.access_token.clone());
        }
        guard.access_token = None;
        guard.expires_at = None;
        (guard.access_token.clone(), guard.refresh_token.clone())
    };
    if let Some(access) = access {
        return Ok(Some(access));
    }
    let Some(refresh) = refresh else {
        return Ok(None);
    };

    match refresh_access_token(&refresh).await {
        Ok(token) => {
            let next_refresh = token.refresh_token.unwrap_or(refresh);
            save_refresh_token(&next_refresh)?;
            let mut guard = session
                .lock()
                .map_err(|_| i18n::msg("backend.spotify.accessFailed"))?;
            guard.access_token = Some(token.access_token.clone());
            guard.refresh_token = Some(next_refresh);
            guard.expires_at =
                Some(Instant::now() + Duration::from_secs(token.expires_in.saturating_sub(30)));
            Ok(Some(token.access_token))
        }
        Err(error) if error == "invalid_grant" => {
            let _ = delete_refresh_token();
            let mut guard = session
                .lock()
                .map_err(|_| i18n::msg("backend.spotify.accessFailed"))?;
            guard.refresh_token = None;
            guard.access_token = None;
            guard.expires_at = None;
            Ok(None)
        }
        Err(_) => Ok(None),
    }
}

#[derive(serde::Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    #[serde(default)]
    refresh_token: Option<String>,
}

async fn exchange_code(code: &str, verifier: &str) -> Result<TokenResponse, String> {
    Client::new()
        .post("https://accounts.spotify.com/api/token")
        .form(&[
            ("client_id", SPOTIFY_CLIENT_ID),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", CALLBACK),
            ("code_verifier", verifier),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<TokenResponse>()
        .await
        .map_err(|error| error.to_string())
}

async fn refresh_access_token(refresh_token: &str) -> Result<TokenResponse, String> {
    let response = Client::new()
        .post("https://accounts.spotify.com/api/token")
        .form(&[
            ("client_id", SPOTIFY_CLIENT_ID),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
        .map_err(|_| "network_error".to_string())?;
    if !response.status().is_success() {
        let error = response
            .json::<TokenError>()
            .await
            .ok()
            .and_then(|value| value.error);
        return Err(error.unwrap_or_else(|| "token_error".into()));
    }
    response
        .json::<TokenResponse>()
        .await
        .map_err(|_| "token_error".into())
}

#[derive(Deserialize)]
struct TokenError {
    error: Option<String>,
}

fn token_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|_| i18n::msg("backend.spotify.vaultOpenFailed"))
}
fn load_refresh_token() -> Result<Option<String>, String> {
    match token_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(i18n::msg("backend.spotify.credentialReadFailed")),
    }
}
fn save_refresh_token(token: &str) -> Result<(), String> {
    token_entry()?
        .set_password(token)
        .map_err(|_| i18n::msg("backend.spotify.credentialSaveFailed"))
}
fn delete_refresh_token() -> Result<(), String> {
    match token_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(i18n::msg("backend.spotify.credentialDeleteFailed")),
    }
}

fn receive_callback(
    listener: TcpListener,
    expected_state: &str,
    pages: &CallbackPages,
) -> Result<String, String> {
    let (mut stream, _) = listener.accept().map_err(|error| error.to_string())?;
    let mut request = [0u8; 8192];
    let bytes = stream
        .read(&mut request)
        .map_err(|error| error.to_string())?;
    let path = std::str::from_utf8(&request[..bytes])
        .ok()
        .and_then(|value| value.lines().next())
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| i18n::msg("backend.spotify.invalidResponse"))?;
    let query = path
        .split_once('?')
        .map(|(_, query)| query)
        .unwrap_or_default();
    let code = query_value(query, "code").ok_or_else(|| i18n::msg("backend.spotify.noCode"))?;
    let state = query_value(query, "state").ok_or_else(|| i18n::msg("backend.spotify.noState"))?;
    let valid = state == expected_state;
    let page = if valid {
        &pages.linked
    } else {
        &pages.mismatch
    };
    let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n<!doctype html><title>UxNow</title><body style=\"font-family:Segoe UI,system-ui;padding:3rem;background:#10131a;color:#eef1f7\">{page}</body>");
    let _ = stream.write_all(response.as_bytes());
    if valid {
        Ok(code)
    } else {
        Err(i18n::msg("backend.spotify.securityCheckFailed"))
    }
}

fn verifier() -> Result<String, String> {
    random_token(64)
}
fn random_token(bytes: usize) -> Result<String, String> {
    let mut value = vec![0u8; bytes];
    random_fill(&mut value).map_err(|error| error.to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(value))
}
fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                char::from(byte).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}
fn query_value(query: &str, name: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        pair.split_once('=')
            .filter(|(key, _)| *key == name)
            .map(|(_, value)| percent_decode(value))
    })
}
fn percent_decode(value: &str) -> String {
    value
        .split('%')
        .enumerate()
        .map(|(index, part)| {
            if index == 0 {
                part.to_string()
            } else {
                u8::from_str_radix(&part[..2], 16)
                    .ok()
                    .map(char::from)
                    .unwrap_or('%')
                    .to_string()
                    + &part[2..]
            }
        })
        .collect::<String>()
}
