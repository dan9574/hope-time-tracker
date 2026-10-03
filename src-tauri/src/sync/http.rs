//! Supabase over HTTPS: GoTrue for auth, PostgREST for the tables (rebuild-plan 12.3 / 12.4).
//! The page never talks to Supabase; everything goes through here.

use std::time::Duration;

use reqwest::{Client, RequestBuilder, StatusCode};
use serde::Deserialize;
use serde_json::{json, Value as Json};

use super::engine::Remote;
use super::error::{SyncError, SyncErrorCode};
use super::tables::{Row, Table};

/// Project settings baked in at build time from the root `.env` (see `build.rs`).
pub struct Config {
    pub url: String,
    pub anon_key: String,
}

impl Config {
    pub fn from_build() -> Option<Self> {
        let url = option_env!("HOPE_SUPABASE_URL")?.trim().trim_end_matches('/');
        let anon_key = option_env!("HOPE_SUPABASE_ANON_KEY")?.trim();
        if url.is_empty() || anon_key.is_empty() {
            return None;
        }
        Some(Self { url: url.to_owned(), anon_key: anon_key.to_owned() })
    }
}

pub fn client() -> Client {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .expect("HTTP client")
}

// ---------------------------------------------------------------------------------------------
// GoTrue

#[derive(Debug, Clone, Deserialize)]
pub struct User {
    pub id: String,
    #[serde(default)]
    pub email: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    /// Seconds.
    pub expires_in: i64,
    pub user: User,
}

pub enum SignUp {
    SignedIn(Tokens),
    /// The project requires email confirmation; no session until the link is clicked.
    ConfirmEmail,
}

async fn send(req: RequestBuilder) -> Result<(StatusCode, String), SyncError> {
    let resp = req.send().await.map_err(SyncError::network)?;
    let status = resp.status();
    let text = resp.text().await.map_err(SyncError::network)?;
    Ok((status, text))
}

fn auth_request(client: &Client, cfg: &Config, path: &str) -> RequestBuilder {
    client.post(format!("{}/auth/v1/{path}", cfg.url)).header("apikey", &cfg.anon_key)
}

/// GoTrue has answered errors in two shapes over the years:
/// `{"error_code": "...", "msg": "..."}` and `{"error": "...", "error_description": "..."}`.
fn auth_error(status: StatusCode, body: &str, refreshing: bool) -> SyncError {
    let parsed: Json = serde_json::from_str(body).unwrap_or(Json::Null);
    let field = |k: &str| parsed.get(k).and_then(Json::as_str).unwrap_or("").to_owned();
    let code = if field("error_code").is_empty() { field("error") } else { field("error_code") };
    let message = [field("msg"), field("error_description"), field("message")]
        .into_iter()
        .find(|m| !m.is_empty())
        .unwrap_or_else(|| format!("HTTP {status}"));
    let kind = if status == StatusCode::TOO_MANY_REQUESTS || code.starts_with("over_") {
        SyncErrorCode::RateLimited
    } else if refreshing && status.is_client_error() {
        SyncErrorCode::SessionExpired
    } else {
        match code.as_str() {
            "invalid_credentials" | "invalid_grant" => SyncErrorCode::InvalidCredentials,
            "email_not_confirmed" => SyncErrorCode::EmailNotConfirmed,
            "user_already_exists" | "email_exists" => SyncErrorCode::UserAlreadyExists,
            "weak_password" => SyncErrorCode::WeakPassword,
            _ => SyncErrorCode::Server,
        }
    };
    SyncError::new(kind, format!("{code}: {message}"))
}

fn parse_tokens(body: &str) -> Result<Tokens, SyncError> {
    serde_json::from_str(body).map_err(|e| SyncError::decode(format!("token response: {e}")))
}

pub async fn sign_in(client: &Client, cfg: &Config, email: &str, password: &str) -> Result<Tokens, SyncError> {
    let req = auth_request(client, cfg, "token?grant_type=password").json(&json!({ "email": email, "password": password }));
    let (status, body) = send(req).await?;
    if !status.is_success() {
        return Err(auth_error(status, &body, false));
    }
    parse_tokens(&body)
}

pub async fn sign_up(client: &Client, cfg: &Config, email: &str, password: &str) -> Result<SignUp, SyncError> {
    let req = auth_request(client, cfg, "signup").json(&json!({ "email": email, "password": password }));
    let (status, body) = send(req).await?;
    if !status.is_success() {
        return Err(auth_error(status, &body, false));
    }
    // With "Confirm email" on, the answer is the new user without a session.
    if body.contains("\"access_token\"") {
        Ok(SignUp::SignedIn(parse_tokens(&body)?))
    } else {
        Ok(SignUp::ConfirmEmail)
    }
}

pub async fn refresh(client: &Client, cfg: &Config, refresh_token: &str) -> Result<Tokens, SyncError> {
    let req = auth_request(client, cfg, "token?grant_type=refresh_token").json(&json!({ "refresh_token": refresh_token }));
    let (status, body) = send(req).await?;
    if !status.is_success() {
        return Err(auth_error(status, &body, true));
    }
    parse_tokens(&body)
}

/// Ends this device's session on the server. Best effort: signing out locally never depends on it.
pub async fn sign_out(client: &Client, cfg: &Config, access_token: &str) {
    let req = auth_request(client, cfg, "logout?scope=local").bearer_auth(access_token);
    if let Err(e) = send(req).await {
        eprintln!("sync: sign-out request failed: {e}");
    }
}

// ---------------------------------------------------------------------------------------------
// PostgREST

/// Hands out a valid access token, refreshing it when it is about to expire or when `force` is set.
pub trait TokenSource {
    fn access_token(&self, force: bool) -> Result<String, SyncError>;
}

/// Blocking adapter over reqwest for the sync thread, which is not a runtime thread:
/// each call runs on Tauri's tokio runtime through `block_on`.
pub struct HttpRemote<'a> {
    pub client: &'a Client,
    pub cfg: &'a Config,
    pub tokens: &'a dyn TokenSource,
}

impl HttpRemote<'_> {
    fn call(&self, build: impl Fn(&str) -> RequestBuilder) -> Result<Vec<Row>, SyncError> {
        let mut token = self.tokens.access_token(false)?;
        for attempt in 0..2 {
            let req = build(&token).header("apikey", &self.cfg.anon_key).bearer_auth(&token);
            let (status, body) = tauri::async_runtime::block_on(send(req))?;
            if status == StatusCode::UNAUTHORIZED && attempt == 0 {
                // Expired or revoked JWT: refresh once and retry.
                token = self.tokens.access_token(true)?;
                continue;
            }
            if !status.is_success() {
                let snippet: String = body.chars().take(300).collect();
                return Err(SyncError::new(SyncErrorCode::Server, format!("HTTP {status}: {snippet}")));
            }
            return serde_json::from_str(&body).map_err(|e| SyncError::decode(format!("PostgREST response: {e}")));
        }
        Err(SyncError::new(SyncErrorCode::SessionExpired, "access token rejected after refresh"))
    }
}

impl Remote for HttpRemote<'_> {
    fn upsert(&self, table: &Table, rows: &[Row]) -> Result<Vec<Row>, SyncError> {
        let url = format!(
            "{}/rest/v1/{}?on_conflict=user_id,{}&columns={}",
            self.cfg.url,
            table.name,
            table.key,
            table.columns.join(",")
        );
        self.call(|_| {
            self.client
                .post(&url)
                .header("Prefer", "resolution=merge-duplicates,return=representation")
                .json(rows)
        })
    }

    fn fetch(&self, table: &Table, after: i64, limit: usize) -> Result<Vec<Row>, SyncError> {
        let url = format!(
            "{}/rest/v1/{}?select=*&server_seq=gt.{after}&order=server_seq.asc&limit={limit}",
            self.cfg.url, table.name
        );
        self.call(|_| self.client.get(&url))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_errors_map_to_codes() {
        let s = StatusCode::BAD_REQUEST;
        assert_eq!(auth_error(s, r#"{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}"#, false).code, SyncErrorCode::InvalidCredentials);
        assert_eq!(auth_error(s, r#"{"error":"invalid_grant","error_description":"Invalid login credentials"}"#, false).code, SyncErrorCode::InvalidCredentials);
        assert_eq!(auth_error(s, r#"{"error_code":"email_not_confirmed","msg":"Email not confirmed"}"#, false).code, SyncErrorCode::EmailNotConfirmed);
        assert_eq!(auth_error(StatusCode::UNPROCESSABLE_ENTITY, r#"{"error_code":"user_already_exists"}"#, false).code, SyncErrorCode::UserAlreadyExists);
        assert_eq!(auth_error(StatusCode::UNPROCESSABLE_ENTITY, r#"{"error_code":"weak_password"}"#, false).code, SyncErrorCode::WeakPassword);
        assert_eq!(auth_error(StatusCode::TOO_MANY_REQUESTS, "", false).code, SyncErrorCode::RateLimited);
        assert_eq!(auth_error(s, r#"{"error_code":"refresh_token_not_found"}"#, true).code, SyncErrorCode::SessionExpired);
        assert_eq!(auth_error(StatusCode::BAD_GATEWAY, "<html>", false).code, SyncErrorCode::Server);
    }

    #[test]
    fn token_response_parses() {
        let t = parse_tokens(
            r#"{"access_token":"a","token_type":"bearer","expires_in":3600,"expires_at":1,"refresh_token":"r","user":{"id":"u","email":"e@x.io","aud":"authenticated"}}"#,
        )
        .unwrap();
        assert_eq!((t.access_token.as_str(), t.refresh_token.as_str(), t.user.id.as_str()), ("a", "r", "u"));
    }
}
