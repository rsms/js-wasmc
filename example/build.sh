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

  # compile C to WASM
  echo "emcc" *.c "-> out/.tmp/foo.js"
  emcc \
    -Os \
    -s WASM=1 \
    -s NO_EXIT_RUNTIME=1 \
    -s NO_FILESYSTEM=1 \
    -s ABORTING_MALLOC=0 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s DISABLE_EXCEPTION_CATCHING=1 \
    *.c -o out/foo.js

  cp -a out/foo.js out/emcc.foo.js
  cp -a out/foo.wasm out/emcc.foo.wasm

  # Bundle, combining your javascript and wasm code
  echo "wasmc out/foo.js foo.js -> out/foo.js"
  ../wasmc.g -syncinit out/foo.js foo.js

  # Run via nodejs
  echo 'Testing in nodejs: require("./out/foo.js").hello()'
  node -e 'require("./out/foo.js").hello()'

  # if we did not provide -embed=sync then we'd have to wait for the
  # "ready" promise before calling functions:
  # echo 'Testing in nodejs via require("./out/foo.js")'
  # node -e 'require("./out/foo.js").ready.then(m => m.hello())'

else
  # Build via Docker using an emsdk image
  if ! (which docker > /dev/null); then
    echo "docker not found in PATH. See https://docker.com/" >&2
    exit 1
  fi
  docker run --rm -t -v "$PWD/..:/src" rsms/emsdk:latest \
    /bin/bash example/build.sh -local
fi
