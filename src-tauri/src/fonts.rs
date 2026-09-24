use std::collections::BTreeMap;

const FONT_REGISTRY_KEYS: [&str; 2] = [
    r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
    r"HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
];

pub fn list_system_fonts() -> Vec<String> {
    let mut families = BTreeMap::<String, String>::new();

    for key in FONT_REGISTRY_KEYS {
        let Ok(output) = crate::native_process::command("reg.exe")
            .args(["query", key])
            .output()
        else {
            continue;
        };
        if !output.status.success() {
            continue;
        }

        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            if let Some(name) = registry_value_name(line).and_then(normalize_family_name) {
                families.entry(name.to_lowercase()).or_insert(name);
            }
        }
    }

    families.into_values().collect()
}

fn registry_value_name(line: &str) -> Option<&str> {
    ["REG_SZ", "REG_EXPAND_SZ", "REG_MULTI_SZ"]
        .iter()
        .find_map(|marker| line.find(marker).map(|index| line[..index].trim()))
        .filter(|name| !name.is_empty())
}

fn normalize_family_name(value: &str) -> Option<String> {
    let mut name = value.trim().to_string();
    for suffix in [" (TrueType)", " (OpenType)", " (All Res)", " (Raster)"] {
        if name.ends_with(suffix) {
            name.truncate(name.len() - suffix.len());
        }
    }

    // Preserve installed faces: collapsing Bold and SemiBold into the regular
    // family made those variants impossible to select.
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_font_registry_rows() {
        assert_eq!(
            registry_value_name(
                "    Segoe UI Variable Text Regular (TrueType)    REG_SZ    SegUIVar.ttf"
            ),
            Some("Segoe UI Variable Text Regular (TrueType)")
        );
    }

    #[test]
    fn keeps_installed_faces_selectable() {
        assert_eq!(
            normalize_family_name("Segoe UI Variable Text Bold Italic (TrueType)"),
            Some("Segoe UI Variable Text Bold Italic".into())
        );
        assert_eq!(
            normalize_family_name("Bahnschrift (TrueType)"),
            Some("Bahnschrift".into())
        );
    }

    #[cfg(windows)]
    #[test]
    fn enumerates_installed_windows_fonts() {
        let fonts = list_system_fonts();
        assert!(!fonts.is_empty());
        assert!(fonts
            .iter()
            .any(|font| font.eq_ignore_ascii_case("Segoe UI")));
        assert!(fonts
            .iter()
            .any(|font| font.eq_ignore_ascii_case("Arial Bold")));
    }
}
