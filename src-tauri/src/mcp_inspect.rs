//! Connect once to a configured MCP server and list what it offers.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use monocode_process_tree::spawn_managed;
use serde::Serialize;
use serde_json::{json, Value};

use crate::fs::expand_home;
use crate::harness::{prepare_child, terminate, which_via_login_shell};
use crate::mcp::read_json;

const PROTOCOL_VERSION: &str = "2025-06-18";
// First runs of `npx`/`uvx` servers download packages before they answer.
const TIMEOUT: Duration = Duration::from_secs(60);
const MAX_PAGES: usize = 20;
const STDERR_TAIL: usize = 4000;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInspection {
    server_name: Option<String>,
    server_version: Option<String>,
    protocol_version: Option<String>,
    instructions: Option<String>,
    /// `None` when the server does not declare the capability.
    tools: Option<Vec<Value>>,
    resources: Option<Vec<Value>>,
    resource_templates: Option<Vec<Value>>,
    prompts: Option<Vec<Value>>,
    errors: Vec<String>,
}

#[derive(Debug, PartialEq)]
enum Spec {
    Stdio {
        command: String,
        args: Vec<String>,
        env: Vec<(String, String)>,
        cwd: Option<String>,
    },
    Http {
        url: String,
        headers: Vec<(String, String)>,
        sse: bool,
    },
}

#[tauri::command]
pub async fn mcp_inspect(
    cwd: String,
    provider: String,
    scope: String,
    config_path: String,
    name: String,
) -> Result<McpInspection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let project = expand_home(&cwd);
        let config = server_config(&provider, &scope, &config_path, &name, &project)?;
        let spec = parse_spec(&config, &|key| std::env::var(key).ok())?;
        let mut transport: Box<dyn Transport> = match spec {
            Spec::Stdio {
                command,
                args,
                env,
                cwd: dir,
            } => {
                let dir = dir
                    .map(|dir| expand_home(&dir))
                    .filter(|dir| dir.is_dir())
                    .or_else(|| project.is_dir().then(|| project.clone()));
                Box::new(StdioTransport::spawn(
                    &command,
                    &args,
                    &env,
                    dir.as_deref(),
                )?)
            }
            Spec::Http {
                url,
                headers,
                sse: true,
            } => Box::new(SseTransport::connect(&url, headers)?),
            Spec::Http { url, headers, .. } => Box::new(HttpTransport::new(url, headers)),
        };
        inspect(transport.as_mut())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn server_config(
    provider: &str,
    scope: &str,
    config_path: &str,
    name: &str,
    project: &Path,
) -> Result<Value, String> {
    if config_path.is_empty() {
        return Err("This server has no local configuration to inspect.".into());
    }
    let path = expand_home(config_path);
    let missing = || format!("{name} was not found in {config_path}");
    if provider == "codex" {
        let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let config: toml::Value = toml::from_str(&raw).map_err(|e| e.to_string())?;
        let server = config
            .get("mcp_servers")
            .and_then(|servers| servers.get(name))
            .ok_or_else(missing)?;
        return serde_json::to_value(server).map_err(|e| e.to_string());
    }
    let config = read_json(&path).ok_or_else(|| format!("Cannot read {config_path}"))?;
    let servers = match provider {
        "claude" if scope == "local" => config
            .get("projects")
            .and_then(|projects| projects.get(project.to_string_lossy().as_ref()))
            .and_then(|entry| entry.get("mcpServers")),
        "opencode" => config.get("mcp").map(|mcp| {
            // OpenCode 2.x nests the map under mcp.servers.
            match mcp.get("servers").and_then(Value::as_object) {
                Some(nested)
                    if nested.values().all(Value::is_object) && nested.contains_key(name) =>
                {
                    &mcp["servers"]
                }
                _ => mcp,
            }
        }),
        _ => config.get("mcpServers"),
    };
    servers
        .and_then(|servers| servers.get(name))
        .filter(|server| server.is_object())
        .cloned()
        .ok_or_else(missing)
}

/// Provider configs share most keys: Claude/Cursor/Pi (`command` + `args`),
/// OpenCode (`command` array, `environment`), Codex (`http_headers`, …).
fn parse_spec(config: &Value, lookup: &dyn Fn(&str) -> Option<String>) -> Result<Spec, String> {
    let text = |value: &Value| value.as_str().map(|raw| expand_vars(raw, lookup));
    let pairs = |key: &str| -> Vec<(String, String)> {
        config
            .get(key)
            .and_then(Value::as_object)
            .map(|map| {
                map.iter()
                    .filter_map(|(k, v)| Some((k.clone(), text(v)?)))
                    .collect()
            })
            .unwrap_or_default()
    };
    if let Some(url) = config.get("url").and_then(text) {
        let mut headers = pairs("headers");
        headers.extend(pairs("http_headers"));
        if let Some(map) = config.get("env_http_headers").and_then(Value::as_object) {
            headers.extend(
                map.iter()
                    .filter_map(|(header, var)| Some((header.clone(), lookup(var.as_str()?)?))),
            );
        }
        if let Some(token) = config
            .get("bearer_token_env_var")
            .and_then(Value::as_str)
            .and_then(lookup)
        {
            headers.push(("Authorization".into(), format!("Bearer {token}")));
        }
        let sse = config.get("type").and_then(Value::as_str) == Some("sse");
        return Ok(Spec::Http { url, headers, sse });
    }
    let mut parts: Vec<String> = match config.get("command") {
        Some(Value::Array(items)) => items.iter().filter_map(text).collect(),
        Some(value) => text(value).into_iter().collect(),
        None => Vec::new(),
    };
    if let Some(args) = config.get("args").and_then(Value::as_array) {
        parts.extend(args.iter().filter_map(text));
    }
    if parts.is_empty() || parts[0].trim().is_empty() {
        return Err("Server configuration has no command or URL".into());
    }
    let command = parts.remove(0);
    let mut env = pairs("env");
    env.extend(pairs("environment"));
    Ok(Spec::Stdio {
        command,
        args: parts,
        env,
        cwd: config.get("cwd").and_then(text),
    })
}

/// `${VAR}`, `${VAR:-default}` (Claude) and `{env:VAR}` (OpenCode).
fn expand_vars(raw: &str, lookup: &dyn Fn(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    loop {
        let dollar = rest.find("${");
        let env = rest.find("{env:");
        let (start, prefix) = match (dollar, env) {
            (Some(d), Some(e)) if e < d => (e, "{env:"),
            (Some(d), _) => (d, "${"),
            (None, Some(e)) => (e, "{env:"),
            (None, None) => break,
        };
        let Some(len) = rest[start..].find('}') else {
            break;
        };
        out.push_str(&rest[..start]);
        let body = &rest[start + prefix.len()..start + len];
        let (key, default) = match body.split_once(":-") {
            Some((key, default)) if prefix == "${" => (key, Some(default)),
            _ => (body, None),
        };
        out.push_str(
            &lookup(key)
                .filter(|value| !value.is_empty())
                .or(default.map(str::to_owned))
                .unwrap_or_default(),
        );
        rest = &rest[start + len + 1..];
    }
    out.push_str(rest);
    out
}

trait Transport {
    fn request(&mut self, method: &str, params: Value) -> Result<Value, String>;
    fn notify(&mut self, method: &str, params: Value) -> Result<(), String>;
}

fn inspect(transport: &mut dyn Transport) -> Result<McpInspection, String> {
    let init = transport.request(
        "initialize",
        json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "MonoCode", "version": env!("CARGO_PKG_VERSION") },
        }),
    )?;
    transport.notify("notifications/initialized", json!({}))?;
    let info = init.get("serverInfo");
    let string = |value: Option<&Value>| value.and_then(Value::as_str).map(str::to_owned);
    let mut inspection = McpInspection {
        server_name: string(info.and_then(|info| info.get("title").or(info.get("name")))),
        server_version: string(info.and_then(|info| info.get("version"))),
        protocol_version: string(init.get("protocolVersion")),
        instructions: string(init.get("instructions")),
        ..Default::default()
    };
    let capabilities = init.get("capabilities").cloned().unwrap_or(Value::Null);
    let mut errors = Vec::new();
    let mut list = |method: &str, key: &str| -> Vec<Value> {
        let mut items = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let params = match &cursor {
                Some(cursor) => json!({ "cursor": cursor }),
                None => json!({}),
            };
            match transport.request(method, params) {
                Ok(page) => {
                    if let Some(page_items) = page.get(key).and_then(Value::as_array) {
                        items.extend(page_items.iter().cloned());
                    }
                    cursor = page
                        .get("nextCursor")
                        .and_then(Value::as_str)
                        .filter(|next| !next.is_empty())
                        .map(str::to_owned);
                    if cursor.is_none() {
                        break;
                    }
                }
                Err(error) => {
                    errors.push(format!("{method}: {error}"));
                    break;
                }
            }
        }
        items
    };
    let declared = |key: &str| capabilities.get(key).is_some();
    let tools = declared("tools").then(|| list("tools/list", "tools"));
    let resources = declared("resources").then(|| list("resources/list", "resources"));
    let resource_templates =
        declared("resources").then(|| list("resources/templates/list", "resourceTemplates"));
    let prompts = declared("prompts").then(|| list("prompts/list", "prompts"));
    inspection.tools = tools;
    inspection.resources = resources;
    inspection.resource_templates = resource_templates;
    inspection.prompts = prompts;
    inspection.errors = errors;
    Ok(inspection)
}

fn rpc_result(message: Value) -> Result<Value, String> {
    if let Some(error) = message.get("error") {
        return Err(error
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| error.to_string()));
    }
    Ok(message.get("result").cloned().unwrap_or(Value::Null))
}

fn is_response(message: &Value, id: u64) -> bool {
    message.get("method").is_none() && message.get("id").and_then(Value::as_u64) == Some(id)
}

struct StdioTransport {
    child: Option<Child>,
    stdin: ChildStdin,
    messages: mpsc::Receiver<Value>,
    stderr: Arc<Mutex<String>>,
    next_id: u64,
}

impl StdioTransport {
    fn spawn(
        command: &str,
        args: &[String],
        env: &[(String, String)],
        cwd: Option<&Path>,
    ) -> Result<Self, String> {
        let program = if Path::new(command).components().count() > 1 {
            expand_home(command)
        } else {
            which_via_login_shell(command).unwrap_or_else(|| command.into())
        };
        let mut cmd = Command::new(&program);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        prepare_child(&mut cmd, command);
        cmd.envs(env.iter().map(|(k, v)| (k, v)));
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        let mut child =
            spawn_managed(&mut cmd).map_err(|e| format!("Failed to start {command}: {e}"))?;
        let stdin = child.stdin.take().ok_or("Server stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("Server stdout unavailable")?;
        let stderr_pipe = child.stderr.take();
        let (tx, messages) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                // Servers sometimes log to stdout; skip anything that is not JSON-RPC.
                if let Ok(message) = serde_json::from_str::<Value>(line.trim()) {
                    if tx.send(message).is_err() {
                        break;
                    }
                }
            }
        });
        let stderr = Arc::new(Mutex::new(String::new()));
        if let Some(pipe) = stderr_pipe {
            let tail = stderr.clone();
            thread::spawn(move || {
                for line in BufReader::new(pipe).lines() {
                    let Ok(line) = line else { break };
                    if let Ok(mut tail) = tail.lock() {
                        tail.push_str(&line);
                        tail.push('\n');
                        if tail.len() > STDERR_TAIL {
                            let mut cut = tail.len() - STDERR_TAIL;
                            while !tail.is_char_boundary(cut) {
                                cut += 1;
                            }
                            tail.drain(..cut);
                        }
                    }
                }
            });
        }
        Ok(Self {
            child: Some(child),
            stdin,
            messages,
            stderr,
            next_id: 0,
        })
    }

    fn send(&mut self, message: &Value) -> Result<(), String> {
        writeln!(self.stdin, "{message}")
            .and_then(|_| self.stdin.flush())
            .map_err(|_| self.exited())
    }

    fn exited(&self) -> String {
        let tail = self.stderr.lock().map(|tail| tail.trim().to_owned());
        match tail {
            Ok(tail) if !tail.is_empty() => format!("Server exited: {tail}"),
            _ => "Server exited before answering".into(),
        }
    }
}

impl Transport for StdioTransport {
    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        let deadline = Instant::now() + TIMEOUT;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let message = match self.messages.recv_timeout(remaining) {
                Ok(message) => message,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    return Err(format!("{method} timed out"));
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => return Err(self.exited()),
            };
            if is_response(&message, id) {
                return rpc_result(message);
            }
            // Answer server requests so servers that ping or ask for roots keep going.
            if let (Some(request), Some(request_id)) = (
                message.get("method").and_then(Value::as_str),
                message.get("id"),
            ) {
                let reply = match request {
                    "ping" => json!({ "jsonrpc": "2.0", "id": request_id, "result": {} }),
                    "roots/list" => {
                        json!({ "jsonrpc": "2.0", "id": request_id, "result": { "roots": [] } })
                    }
                    _ => json!({
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "error": { "code": -32601, "message": "Method not found" },
                    }),
                };
                self.send(&reply)?;
            }
        }
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.send(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }
}

impl Drop for StdioTransport {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            terminate(child.id());
            thread::spawn(move || {
                let _ = child.wait();
            });
        }
    }
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(TIMEOUT)
        .build()
}

fn http_error(error: ureq::Error) -> String {
    match error {
        ureq::Error::Status(401 | 403, _) => {
            "Authentication required. Sign in to this server through its provider; \
             OAuth sessions stored by providers cannot be reused here."
                .into()
        }
        ureq::Error::Status(code, response) => {
            let body = response.into_string().unwrap_or_default();
            let body = body.trim();
            if body.is_empty() {
                format!("HTTP {code}")
            } else {
                format!(
                    "HTTP {code}: {}",
                    body.chars().take(400).collect::<String>()
                )
            }
        }
        error => error.to_string(),
    }
}

/// Read `event`/`data` pairs from a Server-Sent Events stream.
fn read_sse(reader: impl Read, mut on_event: impl FnMut(&str, &str) -> bool) {
    let mut event = String::new();
    let mut data = String::new();
    for line in BufReader::new(reader).lines() {
        let Ok(line) = line else { return };
        if line.is_empty() {
            if !data.is_empty() && !on_event(&event, &data) {
                return;
            }
            event.clear();
            data.clear();
        } else if let Some(value) = line.strip_prefix("event:") {
            event = value.trim().to_owned();
        } else if let Some(value) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(value.strip_prefix(' ').unwrap_or(value));
        }
    }
}

/// Streamable HTTP: each request is a POST answered with JSON or an SSE stream.
struct HttpTransport {
    agent: ureq::Agent,
    url: String,
    headers: Vec<(String, String)>,
    session: Option<String>,
    protocol: Option<String>,
    next_id: u64,
}

impl HttpTransport {
    fn new(url: String, headers: Vec<(String, String)>) -> Self {
        Self {
            agent: agent(),
            url,
            headers,
            session: None,
            protocol: None,
            next_id: 0,
        }
    }

    fn post(&mut self, body: &Value) -> Result<ureq::Response, String> {
        let mut request = self
            .agent
            .post(&self.url)
            .set("Content-Type", "application/json")
            .set("Accept", "application/json, text/event-stream");
        for (key, value) in &self.headers {
            request = request.set(key, value);
        }
        if let Some(session) = &self.session {
            request = request.set("Mcp-Session-Id", session);
        }
        if let Some(protocol) = &self.protocol {
            request = request.set("MCP-Protocol-Version", protocol);
        }
        let response = request.send_string(&body.to_string()).map_err(http_error)?;
        if let Some(session) = response.header("mcp-session-id") {
            self.session = Some(session.to_owned());
        }
        Ok(response)
    }
}

impl Transport for HttpTransport {
    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        let response =
            self.post(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        let mut found = None;
        if response.content_type() == "text/event-stream" {
            read_sse(
                response.into_reader(),
                |_, data| match serde_json::from_str::<Value>(data) {
                    Ok(message) if is_response(&message, id) => {
                        found = Some(message);
                        false
                    }
                    _ => true,
                },
            );
        } else {
            let raw = response.into_string().map_err(|e| e.to_string())?;
            let body: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            found = match body {
                Value::Array(batch) => batch.into_iter().find(|message| is_response(message, id)),
                message => Some(message),
            };
        }
        let result = rpc_result(found.ok_or_else(|| format!("{method}: no response"))?)?;
        if method == "initialize" {
            self.protocol = result
                .get("protocolVersion")
                .and_then(Value::as_str)
                .map(str::to_owned);
        }
        Ok(result)
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.post(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
            .map(|_| ())
    }
}

/// Legacy HTTP+SSE: a GET stream announces a POST endpoint and carries replies.
struct SseTransport {
    agent: ureq::Agent,
    endpoint: String,
    headers: Vec<(String, String)>,
    messages: mpsc::Receiver<Value>,
    next_id: u64,
}

impl SseTransport {
    fn connect(url: &str, headers: Vec<(String, String)>) -> Result<Self, String> {
        let agent = agent();
        let mut request = agent.get(url).set("Accept", "text/event-stream");
        for (key, value) in &headers {
            request = request.set(key, value);
        }
        let response = request.call().map_err(http_error)?;
        let base = url::Url::parse(url).map_err(|e| e.to_string())?;
        let (endpoint_tx, endpoint_rx) = mpsc::channel();
        let (tx, messages) = mpsc::channel();
        thread::spawn(move || {
            read_sse(response.into_reader(), |event, data| {
                if event == "endpoint" {
                    let _ = endpoint_tx.send(base.join(data.trim()).map(String::from));
                    return true;
                }
                match serde_json::from_str::<Value>(data) {
                    Ok(message) => tx.send(message).is_ok(),
                    Err(_) => true,
                }
            });
        });
        let endpoint = endpoint_rx
            .recv_timeout(TIMEOUT)
            .map_err(|_| "Server did not announce an SSE endpoint".to_string())?
            .map_err(|e| e.to_string())?;
        Ok(Self {
            agent,
            endpoint,
            headers,
            messages,
            next_id: 0,
        })
    }

    fn post(&self, body: &Value) -> Result<(), String> {
        let mut request = self
            .agent
            .post(&self.endpoint)
            .set("Content-Type", "application/json");
        for (key, value) in &self.headers {
            request = request.set(key, value);
        }
        request
            .send_string(&body.to_string())
            .map(|_| ())
            .map_err(http_error)
    }
}

impl Transport for SseTransport {
    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        self.post(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        let deadline = Instant::now() + TIMEOUT;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match self.messages.recv_timeout(remaining) {
                Ok(message) if is_response(&message, id) => return rpc_result(message),
                Ok(_) => continue,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    return Err(format!("{method} timed out"));
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("Server closed the event stream".into());
                }
            }
        }
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.post(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup(key: &str) -> Option<String> {
        (key == "TOKEN").then(|| "secret".to_owned())
    }

    #[test]
    fn expands_claude_and_opencode_variables() {
        assert_eq!(
            expand_vars("a ${TOKEN} ${MISSING:-x} {env:TOKEN} ${NONE}", &lookup),
            "a secret x secret "
        );
    }

    #[test]
    fn parses_stdio_shapes_across_providers() {
        let claude = json!({ "command": "npx", "args": ["-y", "pkg"], "env": { "K": "${TOKEN}" } });
        assert_eq!(
            parse_spec(&claude, &lookup).unwrap(),
            Spec::Stdio {
                command: "npx".into(),
                args: vec!["-y".into(), "pkg".into()],
                env: vec![("K".into(), "secret".into())],
                cwd: None,
            }
        );
        let opencode = json!({ "type": "local", "command": ["node", "server.js"], "environment": { "A": "b" } });
        assert_eq!(
            parse_spec(&opencode, &lookup).unwrap(),
            Spec::Stdio {
                command: "node".into(),
                args: vec!["server.js".into()],
                env: vec![("A".into(), "b".into())],
                cwd: None,
            }
        );
    }

    #[test]
    fn parses_remote_headers_including_codex_tokens() {
        let codex = json!({
            "url": "https://example.com/mcp",
            "bearer_token_env_var": "TOKEN",
            "http_headers": { "X-A": "1" },
        });
        assert_eq!(
            parse_spec(&codex, &lookup).unwrap(),
            Spec::Http {
                url: "https://example.com/mcp".into(),
                headers: vec![
                    ("X-A".into(), "1".into()),
                    ("Authorization".into(), "Bearer secret".into()),
                ],
                sse: false,
            }
        );
        let sse = json!({ "type": "sse", "url": "https://example.com/sse" });
        assert!(matches!(
            parse_spec(&sse, &lookup),
            Ok(Spec::Http { sse: true, .. })
        ));
    }

    #[test]
    fn locates_claude_local_and_opencode_nested_servers() {
        let dir = std::env::temp_dir().join(format!("monocode-mcp-inspect-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let claude = dir.join("claude.json");
        std::fs::write(
            &claude,
            r#"{"projects":{"/p":{"mcpServers":{"a":{"command":"x"}}}}}"#,
        )
        .unwrap();
        let path = claude.to_string_lossy();
        assert_eq!(
            server_config("claude", "local", &path, "a", Path::new("/p")).unwrap(),
            json!({ "command": "x" })
        );
        assert!(server_config("claude", "user", &path, "a", Path::new("/p")).is_err());
        let opencode = dir.join("opencode.json");
        std::fs::write(
            &opencode,
            r#"{"mcp":{"servers":{"b":{"url":"https://x"}}}}"#,
        )
        .unwrap();
        assert_eq!(
            server_config(
                "opencode",
                "user",
                &opencode.to_string_lossy(),
                "b",
                Path::new("/p")
            )
            .unwrap(),
            json!({ "url": "https://x" })
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn inspects_a_stdio_server() {
        // A shell stand-in that answers initialize, then tools/list.
        let script = r#"read a; echo '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"demo","version":"1"}}}'; read b; read c; echo 'log line'; echo '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"echo"}]}}'; read d"#;
        let mut transport =
            StdioTransport::spawn("sh", &["-c".into(), script.into()], &[], None).unwrap();
        let inspection = inspect(&mut transport).unwrap();
        assert_eq!(inspection.server_name.as_deref(), Some("demo"));
        assert_eq!(inspection.tools, Some(vec![json!({ "name": "echo" })]));
        assert!(inspection.resources.is_none());
        assert!(inspection.errors.is_empty());
    }
}
