use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OtoEntry {
    pub filename: String,
    pub alias: String,
    pub offset: f64,
    pub consonant: f64,
    pub cutoff: f64,
    pub preutterance: f64,
    pub overlap: f64,
}

/// `(prefix, suffix)` attached to an alias for notes at or above a pitch.
pub type PrefixMap = HashMap<i32, (String, String)>;

/// All entries of a voicebank plus a case/whitespace-insensitive index, so
/// that lookups never have to scan the whole bank.
#[derive(Default)]
pub struct OtoBank {
    entries: HashMap<String, OtoEntry>,
    lowercase_index: HashMap<String, String>,
}

fn fold(alias: &str) -> String {
    alias.trim().to_lowercase()
}

impl OtoBank {
    pub fn from_entries(entries: HashMap<String, OtoEntry>) -> Self {
        let lowercase_index = entries.keys().map(|k| (fold(k), k.clone())).collect();
        Self {
            entries,
            lowercase_index,
        }
    }

    pub fn iter(&self) -> impl Iterator<Item = &OtoEntry> {
        self.entries.values()
    }

    pub fn find(&self, alias: &str) -> Option<&OtoEntry> {
        if let Some(entry) = self.entries.get(alias) {
            return Some(entry);
        }
        let key = self.lowercase_index.get(&fold(alias))?;
        self.entries.get(key)
    }
}

pub fn parse_oto_ini(data: &[u8]) -> Result<HashMap<String, OtoEntry>> {
    let text = String::from_utf8_lossy(data);
    let mut oto_map = HashMap::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        let Some(eq_pos) = line.find('=') else {
            continue;
        };
        let filename = line[..eq_pos].trim().to_string();
        let mut params = line[eq_pos + 1..].split(',');
        let alias_raw = params.next().unwrap_or("").trim();
        let alias = if alias_raw.is_empty() {
            let lower = filename.to_lowercase();
            if lower.ends_with(".wav") {
                filename[..filename.len() - 4].to_string()
            } else {
                filename.clone()
            }
        } else {
            alias_raw.to_string()
        };

        let params: Vec<f64> = params
            .map(|p| p.trim().parse().unwrap_or(0.0))
            .collect();
        if params.len() < 5 {
            continue;
        }
        oto_map.insert(
            alias.clone(),
            OtoEntry {
                filename,
                alias,
                offset: params[0],
                consonant: params[1],
                cutoff: params[2],
                preutterance: params[3],
                overlap: params[4],
            },
        );
    }

    if oto_map.is_empty() {
        return Err(anyhow!("Failed to read any entries from oto.ini."));
    }
    Ok(oto_map)
}

/// Lines look like `C4=prefix<TAB>suffix`. Without a tab the whole value is
/// treated as a suffix.
pub fn parse_prefix_map(data: &[u8]) -> PrefixMap {
    let text = String::from_utf8_lossy(data);
    let mut prefix_map = PrefixMap::new();

    for line in text.lines() {
        let Some(eq_pos) = line.find('=') else {
            continue;
        };
        let Ok(pitch) = crate::util::pitch_parser(&line[..eq_pos]) else {
            continue;
        };
        let value = line[eq_pos + 1..].trim_end_matches(['\r', '\n']);
        let entry = match value.split_once('\t') {
            Some((prefix, suffix)) => (prefix.to_string(), suffix.to_string()),
            None => (String::new(), value.to_string()),
        };
        prefix_map.insert(pitch, entry);
    }

    prefix_map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oto_lookup_is_case_insensitive() {
        let data = b"a.wav=Ka,10,20,-30,40,5\r\n";
        let bank = OtoBank::from_entries(parse_oto_ini(data).unwrap());
        assert!(bank.find("Ka").is_some());
        assert!(bank.find(" ka ").is_some());
        assert!(bank.find("ga").is_none());
        assert_eq!(bank.find("ka").unwrap().cutoff, -30.0);
    }

    #[test]
    fn empty_alias_uses_filename() {
        let bank = OtoBank::from_entries(parse_oto_ini(b"sa.wav=,0,0,0,0,0").unwrap());
        assert!(bank.find("sa").is_some());
    }

    #[test]
    fn prefix_map_prefix_and_suffix() {
        let map = parse_prefix_map(b"C4=pre\tsuf\nD4=\t_D\nE4=_E\n");
        assert_eq!(map[&60], ("pre".into(), "suf".into()));
        assert_eq!(map[&62], ("".into(), "_D".into()));
        assert_eq!(map[&64], ("".into(), "_E".into()));
    }
}
