fn main() {
    let world_dir: &str = "World";
    let world_src: &str = &format!("{}/{}", world_dir, "src");
    let _world_header: &str = &format!("{}/{}", world_src, "world");

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
    for file_name in &file_names {
        cc::Build::new()
            .cpp(true)
            // .warnings(true)
            .flag("-w")
            .file(&format!("{}/{}.cpp", world_src, file_name))
            .include(world_src)
            .compile(&format!("{}", file_name));
    }
}
