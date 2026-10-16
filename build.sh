#!/usr/bin/env bash
# Builds the Rust engine to WebAssembly and copies it into src/lib/engine/wasm.
#   ./build.sh            debug build
#   ./build.sh release    optimized build
set -euo pipefail

cd "$(dirname "$0")"

DEST_DIR="./src/lib/engine/wasm"
JS_FILE="w-synth.js"
WASM_FILE="w-synth.wasm"

case "${1:-}" in
  release|--release) CARGO_FLAGS="--release" ;;
  "") CARGO_FLAGS="" ;;
  *)
    echo "Invalid build mode '$1'. Use 'release' or no argument for a debug build." >&2
    exit 1
    ;;
esac

if ! command -v em++ >/dev/null 2>&1; then
  echo "Emscripten (em++) was not found. Install emsdk and source emsdk_env.sh first." >&2
  exit 1
fi

# The linker args in .cargo/config.toml make em++ write the artifacts here.
rm -f "./$JS_FILE" "./$WASM_FILE"
cargo build -p w-synth --target wasm32-unknown-emscripten $CARGO_FLAGS

mkdir -p "$DEST_DIR"
mv "./$JS_FILE" "./$WASM_FILE" "$DEST_DIR/"
echo "Engine written to $DEST_DIR ($(du -h "$DEST_DIR/$WASM_FILE" | cut -f1))"
