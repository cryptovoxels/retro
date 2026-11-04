#!/bin/sh
set -eu
# Use the same pinned PVRTexTool 5.7.1 Linux binary as the compressor image.
printf '%s  %s\n' '3ef9302b721b42cdc68dc8126de1f95f7b0a5acedd363b7176c002fad6e5e731' "$1" | shasum -a 256 -c -
cp "$1" "$(dirname "$0")/packages/textures/compress/PVRTexToolCLI"
chmod +x "$(dirname "$0")/packages/textures/compress/PVRTexToolCLI"
