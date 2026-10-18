//! UI project identities preserve Linux paths without treating them as Windows paths.
#[derive(Debug, PartialEq)]
pub(crate) struct WslPath {
    pub distribution: String,
    pub path: String,
}

fn decode(value: &str) -> Result<String, String> {
    let mut bytes = Vec::new();
    let input = value.as_bytes();
    let mut i = 0;
    while i < input.len() {
        if input[i] == b'%' {
            let pair = input
                .get(i + 1..i + 3)
                .ok_or("Invalid WSL distribution encoding")?;
            let hex = std::str::from_utf8(pair).map_err(|_| "Invalid WSL distribution encoding")?;
            bytes.push(
                u8::from_str_radix(hex, 16).map_err(|_| "Invalid WSL distribution encoding")?,
            );
            i += 3;
        } else {
            bytes.push(input[i]);
            i += 1;
        }
    }
    String::from_utf8(bytes).map_err(|_| "Invalid WSL distribution encoding".into())
}

fn encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            encoded.push(byte as char);
        } else {
            use std::fmt::Write;
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

pub(crate) fn parse(value: &str) -> Result<Option<WslPath>, String> {
    let Some(rest) = value.strip_prefix("wsl://") else {
        return Ok(None);
    };
    let (name, path) = rest
        .find('/')
        .map_or((rest, "/"), |index| (&rest[..index], &rest[index..]));
    let distribution = decode(name)?;
    if distribution.trim().is_empty()
        || distribution
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
        || path.contains('\0')
    {
        return Err("Invalid WSL project identity".into());
    }
    Ok(Some(WslPath {
        distribution,
        path: path.into(),
    }))
}

impl WslPath {
    /// Matches host/checkout-guards.ts; Linux paths remain case-sensitive.
    pub fn resource_key(&self) -> String {
        let mut parts = Vec::new();
        for part in self.path.split('/') {
            match part {
                "" | "." => {}
                ".." => {
                    parts.pop();
                }
                value => parts.push(value),
            }
        }
        format!(
            "{}:/{}",
            encode(&format!("wsl:{}", self.distribution)),
            parts.join("/")
        )
    }

    #[cfg(any(windows, test))]
    pub fn shell(&self) -> (String, Vec<String>) {
        (
            "wsl.exe".into(),
            vec![
                "--distribution".into(),
                self.distribution.clone(),
                "--cd".into(),
                self.path.clone(),
            ],
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_linux_paths_and_decodes_only_the_distribution() {
        let value = parse("wsl://Ubuntu%20Dev/home/wy/Upper%20Case")
            .unwrap()
            .unwrap();
        assert_eq!(value.distribution, "Ubuntu Dev");
        assert_eq!(value.path, "/home/wy/Upper%20Case");
        assert_eq!(
            value.resource_key(),
            "wsl%3AUbuntu%20Dev:/home/wy/Upper%20Case"
        );
        assert_eq!(
            value.shell().1,
            [
                "--distribution",
                "Ubuntu Dev",
                "--cd",
                "/home/wy/Upper%20Case"
            ]
        );
        assert!(parse("wsl://bad%00/home").is_err());
        assert!(parse("wsl://bad%2Fname/home").is_err());
        assert_eq!(parse("C:\\work").unwrap(), None);
    }
}
