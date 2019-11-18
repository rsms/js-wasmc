#!/bin/bash -e
cd "$(dirname "$0")/.."

./deps/build.sh

DEBUG=false
ROLLUP_WATCH=
if [[ "$1" == "-w" ]]; then
  ROLLUP_WATCH=--watch
  DEBUG=true
  shift
fi
if [[ "$1" == "-g" ]]; then
  DEBUG=true
  shift
fi

touch wasmc.g
chmod +x wasmc.g

./node_modules/.bin/rollup src/wasmc.js \
  --file wasmc.g \
  --format cjs \
  --name wasmc \
  --sourcemap \
  --intro "const WASMC_VERSION='"$(node -p 'require("./package.json").version')"'" \
  --banner '#!/usr/bin/env node' \
  $ROLLUP_WATCH

if ! $DEBUG; then

# strip comments
node <<_JS
let fs = require('fs')
let s = fs.readFileSync("wasmc.g", "utf8")
// replace with whitespace and linebreaks to not mess up sourcemap
s = s.replace(/(?:^|\n\s*)\/\*(?:(?!\*\/).)*\*\//gms, s => {
  let s2 = ""
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) == 0xA) {
      s2 += "\n"
    } else {
      s2 += " "
    }
  }
  return s2
})
fs.writeFileSync(".wasmc.o1", s, "utf8")
_JS

  CCOMPILER=$(node -e "process.stdout.write(require('google-closure-compiler/lib/utils').getNativeImagePath())")
  echo "running closure-compiler"
  $CCOMPILER \
    -O=SIMPLE \
    --js=.wasmc.o1 \
    --js_output_file=wasmc \
    --language_in=ECMASCRIPT_2018 \
    --language_out=ECMASCRIPT_2018 \
    --env=CUSTOM \
    \
    --module_resolution=NODE \
    --package_json_entry_names=esnext:main,browser,main \
    --assume_function_wrapper \
    --create_source_map=wasmc.map \
    --source_map_input=".wasmc.o1|wasmc.g.map" \
    \
    --charset=UTF-8 \
    --output_wrapper="$(printf "#!/usr/bin/env node\n%%output%%\n//#sourceMappingURL=wasmc.map")"

  rm .wasmc.o1
  chmod +x wasmc
fi
