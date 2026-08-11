use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());

    let world_src = manifest_dir.join("World").join("src");

    let file_names = [
        "cheaptrick",
        "codec",
        "common",
        "d4c",
        "dio",
        "fft",
        "harvest",
        "matlabfunctions",
        "stonemask",
        "synthesis",
        "synthesisrealtime",
    ];

    for file_name in file_names {
        cc::Build::new()
            .cpp(true)
            .flag("-w")
            .file(world_src.join(format!("{file_name}.cpp")))
            .include(&world_src)
            .compile(file_name);
    }
}
