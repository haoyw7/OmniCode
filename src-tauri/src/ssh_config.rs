use serde::Serialize;
use std::path::{Path, PathBuf};

/// A concrete `Host` alias from the user's OpenSSH configuration.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigHost {
    pub alias: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

const MAX_INCLUDE_DEPTH: usize = 8;

fn split(line: &str) -> Option<(String, &str)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let end = line.find(|c: char| c.is_whitespace() || c == '=')?;
    let value = line[end..].trim_start_matches(|c: char| c.is_whitespace() || c == '=');
    Some((line[..end].to_ascii_lowercase(), value.trim()))
}

fn unquote(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .unwrap_or(value)
}

/// Expands an `Include` argument; only the file name may contain `*` or `?`.
fn include_paths(pattern: &str, ssh_dir: &Path, home: &Path) -> Vec<PathBuf> {
    let pattern = unquote(pattern);
    let path = if let Some(rest) = pattern.strip_prefix("~/") {
        home.join(rest)
    } else if Path::new(pattern).is_absolute() {
        PathBuf::from(pattern)
    } else {
        ssh_dir.join(pattern)
    };
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned());
    match (name, path.parent()) {
        (Some(name), Some(parent)) if name.contains(['*', '?']) => {
            let mut found: Vec<PathBuf> = std::fs::read_dir(parent)
                .into_iter()
                .flatten()
                .flatten()
                .filter(|entry| wildcard(&name, &entry.file_name().to_string_lossy()))
                .map(|entry| entry.path())
                .filter(|path| path.is_file())
                .collect();
            found.sort();
            found
        }
        _ => vec![path],
    }
}

fn wildcard(pattern: &str, text: &str) -> bool {
    fn matches(p: &[char], t: &[char]) -> bool {
        match (p.first(), t.first()) {
            (None, None) => true,
            (Some('*'), _) => matches(&p[1..], t) || (!t.is_empty() && matches(p, &t[1..])),
            (Some('?'), Some(_)) => matches(&p[1..], &t[1..]),
            (Some(a), Some(b)) if a == b => matches(&p[1..], &t[1..]),
            _ => false,
        }
    }
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    matches(&p, &t)
}

fn collect(path: &Path, ssh_dir: &Path, home: &Path, depth: usize, hosts: &mut Vec<SshConfigHost>) {
    if depth > MAX_INCLUDE_DEPTH {
        return;
    }
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    // Indices of the hosts the current `Host` block declares.
    let mut current: Vec<usize> = Vec::new();
    for line in text.lines() {
        let Some((key, value)) = split(line) else {
            continue;
        };
        match key.as_str() {
            "host" => {
                current.clear();
                for alias in value.split_whitespace().map(unquote) {
                    if alias.is_empty() || alias.contains(['*', '?', '!']) {
                        continue;
                    }
                    let index = match hosts.iter().position(|host| host.alias == alias) {
                        Some(index) => index,
                        None => {
                            hosts.push(SshConfigHost {
                                alias: alias.to_string(),
                                ..Default::default()
                            });
                            hosts.len() - 1
                        }
                    };
                    current.push(index);
                }
            }
            // A Match block's options do not belong to the preceding Host.
            "match" => current.clear(),
            "include" => {
                for pattern in value.split_whitespace() {
                    for included in include_paths(pattern, ssh_dir, home) {
                        collect(&included, ssh_dir, home, depth + 1, hosts);
                    }
                }
            }
            // OpenSSH keeps the first value it reads for each option.
            "hostname" | "user" | "port" => {
                for &index in &current {
                    let host = &mut hosts[index];
                    let value = unquote(value).to_string();
                    match key.as_str() {
                        "hostname" if host.host_name.is_none() => host.host_name = Some(value),
                        "user" if host.user.is_none() => host.user = Some(value),
                        "port" if host.port.is_none() => host.port = value.parse().ok(),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
}

pub fn read_hosts(home: &Path) -> Vec<SshConfigHost> {
    let ssh_dir = home.join(".ssh");
    let mut hosts = Vec::new();
    collect(&ssh_dir.join("config"), &ssh_dir, home, 0, &mut hosts);
    hosts
}

/// Host aliases from `~/.ssh/config` for the SSH address picker.
#[tauri::command(async)]
pub fn remote_ssh_config_hosts() -> Vec<SshConfigHost> {
    crate::dirs_home()
        .map(|home| read_hosts(Path::new(&home)))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_concrete_hosts_through_includes() {
        let home = std::env::temp_dir().join(format!("monocode-ssh-config-{}", std::process::id()));
        let ssh = home.join(".ssh");
        std::fs::create_dir_all(ssh.join("config.d")).unwrap();
        std::fs::write(
            ssh.join("config"),
            "Include config.d/*.conf\n\nHost vps prod\n  HostName 47.122.127.145\n  User=root\n  Port 2222\n\nHost * !bastion\n  User ignored\n\nMatch host vps\n  User matched\n\nHost wy-win\n  HostName 100.69.154.36\n",
        )
        .unwrap();
        std::fs::write(
            ssh.join("config.d/work.conf"),
            "Host \"fs-arm\"\n  HostName fs.local\n",
        )
        .unwrap();
        let hosts = read_hosts(&home);
        std::fs::remove_dir_all(&home).unwrap();
        let aliases: Vec<&str> = hosts.iter().map(|host| host.alias.as_str()).collect();
        assert_eq!(aliases, ["fs-arm", "vps", "prod", "wy-win"]);
        assert_eq!(
            hosts[1],
            SshConfigHost {
                alias: "vps".into(),
                host_name: Some("47.122.127.145".into()),
                user: Some("root".into()),
                port: Some(2222),
            }
        );
        assert_eq!(hosts[3].host_name.as_deref(), Some("100.69.154.36"));
    }
}
