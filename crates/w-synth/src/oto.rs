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
        // A byte order mark (in front of the first line of a file, or of each merged file) is not part of the name.
        let line = line.trim().trim_start_matches('\u{feff}').trim();
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

    #[test]
    fn a_byte_order_mark_does_not_end_up_in_the_first_file_name() {
        let data = "\u{feff}a.wav=a,1,2,3,4,5\r\nb.wav=b,1,2,3,4,5\r\n";
        let map = parse_oto_ini(data.as_bytes()).unwrap();
        assert_eq!(map["a"].filename, "a.wav");
        assert_eq!(map["b"].filename, "b.wav");
    }

    #[test]
    fn comments_blank_lines_crlf_and_spaces_are_tolerated() {
        let data = b"# comment\r\n; another\r\n\r\n  ka.wav = ka , 10 , 20 , -30 , 40 , 5 \r\nsa.wav=sa,0,0,0,0,0\n";
        let map = parse_oto_ini(data).unwrap();
        assert_eq!(map.len(), 2);
        let ka = &map["ka"];
        assert_eq!((ka.offset, ka.consonant, ka.cutoff, ka.preutterance, ka.overlap), (10.0, 20.0, -30.0, 40.0, 5.0));
    }

    #[test]
    fn lines_with_too_few_values_or_garbage_numbers_are_handled() {
        let map = parse_oto_ini(b"a.wav=a,1,2,3\nb.wav=b,x,y,z,w,v\nc.wav=c,1.5,2.5,3.5,4.5,5.5,6.5\n").unwrap();
        assert!(!map.contains_key("a"), "four values are not enough");
        assert_eq!(map["b"].offset, 0.0, "unreadable numbers count as zero");
        assert_eq!(map["c"].overlap, 5.5);
    }

    #[test]
    fn the_last_of_two_identical_aliases_wins() {
        let map = parse_oto_ini(b"x.wav=a,1,0,0,0,0\ny.wav=a,2,0,0,0,0\n").unwrap();
        assert_eq!(map["a"].filename, "y.wav");
    }

    #[test]
    fn an_uppercase_extension_still_gives_the_alias_from_the_file_name() {
        let map = parse_oto_ini(b"KA.WAV=,0,0,0,0,0\nsub/sa.wav=,0,0,0,0,0\nna=,0,0,0,0,0\n").unwrap();
        assert!(map.contains_key("KA"));
        assert!(map.contains_key("sub/sa"));
        assert!(map.contains_key("na"));
    }

    #[test]
    fn lookup_ignores_case_and_surrounding_spaces_but_not_inner_ones() {
        let bank = OtoBank::from_entries(parse_oto_ini("a.wav=- あ,0,0,0,0,0\n".as_bytes()).unwrap());
        assert!(bank.find("- あ").is_some());
        assert!(bank.find("  - あ ").is_some());
        assert!(bank.find("-あ").is_none());
        assert_eq!(bank.iter().count(), 1);
    }

    #[test]
    fn prefix_map_lines_in_every_form() {
        let map = parse_prefix_map(b"C4=pre\tsuf\r\n60=\t_x\nD#5=only\nnot a line\n=empty\nQ9=bad\n");
        assert_eq!(map[&60], (String::new(), "_x".to_string()), "later line for the same pitch wins");
        assert_eq!(map[&75], (String::new(), "only".to_string()));
        assert_eq!(map.len(), 2);
        assert!(parse_prefix_map(b"").is_empty());
    }
}
