#!/bin/sh
set -eu
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
archive=${LUA_ARCHIVE:-$tmp/lua.tar.gz}
if [ ! -f "$archive" ]; then curl -fsSL https://www.lua.org/ftp/lua-5.4.7.tar.gz -o "$archive"; fi
echo "9fbf5e28ef86c69858f6d3d34eccc32e911c1a28b4120ff3e84aaa70cfbf1e30  $archive" | shasum -a 256 -c -
tar xzf "$archive" -C "$tmp"
src="$tmp/lua-5.4.7/src"
set -- sim.c
for name in lapi lauxlib lbaselib lcode lctype ldebug ldo ldump lfunc lgc llex lmem lmathlib lobject lopcodes lparser lstate lstring ltable ltm lundump lvm lzio; do
  set -- "$@" "$src/$name.c"
done
emcc "$@" -I"$src" -Oz -flto --no-entry -sMODULARIZE -sSINGLE_FILE -sENVIRONMENT=node -sFILESYSTEM=0 -sINITIAL_MEMORY=4194304 -sSTACK_SIZE=262144 -sEXPORTED_FUNCTIONS=_boot,_add,_tick,_reset,_flock,_burrow,_bird_state -sEXPORTED_RUNTIME_METHODS=ccall,HEAPF32 -o core.cjs
