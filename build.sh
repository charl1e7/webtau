set -e

DEST_DIR="./src/lib"
JS_FILE="w-synth.js"
WASM_FILE="w-synth.wasm"
CARGO_FLAGS=""
BUILD_MODE="debug"

case "$1" in
  release|--release)
    BUILD_MODE="release"
    CARGO_FLAGS="--release"
    ;;
  "")
    BUILD_MODE="debug"
    CARGO_FLAGS=""
    ;;
  *)
    echo "Error: Invalid build mode '$1'. Use 'release' or no flag for 'debug'."
    exit 1
    ;;
esac

echo "--- Running build and file move script (mode: $BUILD_MODE) ---"

echo "Starting project build"
cargo build --target wasm32-unknown-emscripten --verbose $CARGO_FLAGS

echo "Build completed successfully."

echo "Checking and creating destination directory: $DEST_DIR"
mkdir -p "$DEST_DIR"

if [ ! -d "$DEST_DIR" ]; then
    echo "Error: Failed to create or find destination directory: $DEST_DIR"
    exit 1
fi

echo "Moving files '$JS_FILE' and '$WASM_FILE' to '$DEST_DIR/'..."

missing_files=0
if [ ! -f "./$JS_FILE" ]; then
    echo "Error: File '$JS_FILE' not found in the current directory."
    missing_files=1
fi
if [ ! -f "./$WASM_FILE" ]; then
    echo "Error: File '$WASM_FILE' not found in the current directory."
    missing_files=1
fi
if [ $missing_files -eq 1 ]; then
    echo "Build failed: required output files are missing."
    exit 1
fi

mv "./$JS_FILE" "$DEST_DIR/"
echo "File '$JS_FILE' moved."
mv "./$WASM_FILE" "$DEST_DIR/"
echo "File '$WASM_FILE' moved."

echo "--- Script finished ---"