#!/bin/sh
# Copy the real game files out of src/, byte-for-byte. Nothing here is
# reimplemented -- that is the whole point of the harness: the physics, the
# built-in AI, the round state machine, the touch-limit rule, the cloud/wave
# model and the snapshot builder are the SAME code the browser runs.
#
# NOT copied, and therefore hand-written (each says so in its header):
#   engine/view.js  engine/audio.js  engine/keyboard.js   -- no-op stubs
#   (engine/view.js does own the real cloud/wave model, because that is a
#    rand() consumer and skipping it desynchronises the shared random stream)
#
# engine/package.json ({"type":"module"}) is what lets Node load these verbatim
# ESM files without editing a single import.
#
# Run this whenever src/ changes. The checksums are the drift alarm.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../../src/resources/js"
DEST="$HERE/engine"

# 이 디렉터리들은 안에 든 파일이 전부 .gitignore 대상이라 새로 클론하면 없다.
mkdir -p "$DEST/rules" "$DEST/operator" "$DEST/bot"

cp "$SRC/physics.js"           "$DEST/physics.js"
cp "$SRC/rand.js"              "$DEST/rand.js"
cp "$SRC/cloud_and_wave.js"    "$DEST/cloud_and_wave.js"
cp "$SRC/pikavolley.js"        "$DEST/pikavolley.js"
cp "$SRC/rules/touchLimit.js"  "$DEST/rules/touchLimit.js"
cp "$SRC/operator/console.js"  "$DEST/operator/console.js"
cp "$SRC/bot/botContract.js"   "$DEST/bot/botContract.js"

echo "verbatim copies (sha1):"
shasum "$DEST/physics.js" "$DEST/rand.js" "$DEST/cloud_and_wave.js" "$DEST/pikavolley.js" \
       "$DEST/rules/touchLimit.js" "$DEST/operator/console.js" "$DEST/bot/botContract.js"
