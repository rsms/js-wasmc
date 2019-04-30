#!/bin/sh
#
# This script builds the example project using Emscripten via docker.
# Nothing else than Docker is required for this to work.
# You can get Docker from Homebrew, Aptitude and other package managers,
# as well as from the Docker website: https://docker.com/
#
# If you have Emscripten and Nodejs installed locally, you can build
# directly, without Docker, with the -local flag: `build.sh -local`
#
set -e
cd "$(dirname "$0")"

if [ "$1" == "-local" ]; then
  mkdir -p out/.tmp

  # compile C to WASM
  echo "emcc" *.c "  ->  out/.tmp/foo.js"
  emcc \
    -s WASM=1 \
    -s NO_EXIT_RUNTIME=1 \
    -s NO_FILESYSTEM=1 \
    -s ABORTING_MALLOC=0 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s DISABLE_EXCEPTION_CATCHING=1 \
    *.c -o out/.tmp/foo.js

  # Bundle, combining your javascript and wasm code
  echo "wasmc out/.tmp/foo.js + foo.js  ->  out/foo.js"
  ../wasmc -g out/.tmp/foo.js foo.js out/foo.js

  # Move wasm binary into output directory
  mv out/.tmp/foo.wasm out/foo.wasm

  # Remove temporary build directory
  rm -rf out/.tmp

  # Run via nodejs
  echo 'Testing in nodejs via require("./out/foo.js")'
  node - <<_JS_
  const foo = require("./out/foo.js")
  foo.onload.then(m => {
    m.hello()
  })
_JS_

else
  # Build via Docker using an emsdk image
  if ! (which docker > /dev/null); then
    echo "docker not found in PATH. See https://docker.com/" >&2
    exit 1
  fi
  docker run --rm -t -v "$PWD/..:/src" rsms/emsdk:latest \
    /bin/bash example/build.sh -local
fi
