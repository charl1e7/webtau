#[derive(Debug, Clone)]
pub struct SynthesisArgs {
    pub alias: String,
    pub out_file: String,
    pub pitch: i32,
    pub velocity: f64,
    pub flags: String,
    pub offset: f64,
    pub length: f64,
    pub consonant: f64,
    pub cutoff: f64,
    pub volume: f64,
    pub modulation: f64,
    pub tempo: f64,
    pub pitchbend: String,
}
