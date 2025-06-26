use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};

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

pub type OtoMap = HashMap<String, OtoEntry>;
pub type PrefixMap = HashMap<i32, String>;

pub fn parse_oto_ini<R: Read>(reader: R) -> Result<OtoMap> {
    let buffered_reader = BufReader::new(reader);
    let mut oto_map = OtoMap::new();

    for line_result in buffered_reader.lines() {
        let line = line_result?;
        if line.trim().is_empty() {
            continue;
        }

        if let Some(eq_pos) = line.find('=') {
            let filename = line[..eq_pos].to_string();
            let value_part = &line[eq_pos + 1..];
            let mut params_iter = value_part.split(',');

            if let Some(alias_raw) = params_iter.next() {
                let alias = alias_raw.trim();
                if alias.is_empty() {
                    continue;
                }

                let params: Vec<&str> = params_iter.collect();
                if params.len() < 5 {
                    continue;
                }

                let entry = OtoEntry {
                    filename,
                    alias: alias.to_string(),
                    offset: params[0].trim().parse().unwrap_or(0.0),
                    consonant: params[1].trim().parse().unwrap_or(0.0),
                    cutoff: params[2].trim().parse().unwrap_or(0.0),
                    preutterance: params[3].trim().parse().unwrap_or(0.0),
                    overlap: params[4].trim().parse().unwrap_or(0.0),
                };
                oto_map.insert(alias.to_string(), entry);
            }
        }
    }

    if oto_map.is_empty() {
        return Err(anyhow!("Failed to read any entries from oto.ini."));
    }
    Ok(oto_map)
}

pub fn parse_prefix_map<R: Read>(reader: R) -> Result<PrefixMap> {
    let buffered_reader = BufReader::new(reader);
    let mut prefix_map = PrefixMap::new();

    for line_result in buffered_reader.lines() {
        let line = line_result?;
        if line.trim().is_empty() {
            continue;
        }

        if let Some(eq_pos) = line.find('=') {
            let note_str = &line[..eq_pos];
            let suffix = line[eq_pos + 1..].to_string();

            if let Ok(pitch) = crate::util::pitch_parser(note_str) {
                prefix_map.insert(pitch, suffix);
            }
        }
    }

    Ok(prefix_map)
}
