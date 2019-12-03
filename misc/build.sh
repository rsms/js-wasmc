#!/bin/bash -e
cd "$(dirname "$0")/.."

./deps/build.sh

DEBUG=false
ROLLUP_ARGS=
if [[ "$1" == "-w" ]]; then
  ROLLUP_ARGS=--watch
  DEBUG=true
  shift
fi
if [[ "$1" == "-g" ]]; then
  DEBUG=true
  shift
fi


function closure-compiler {
  if [[ -z $CCOMPILER ]]; then
    CCOMPILER=$(node -e "process.stdout.write(require('google-closure-compiler/lib/utils').getNativeImagePath())")
  fi
  "$CCOMPILER" "$@"
}


WASMC_VERSION=$(node -p 'require("./package.json").version')
if [[ -d .git ]]; then
  WASMC_VERSION="$WASMC_VERSION+$(git rev-parse --short HEAD)"
fi


# prerequisites
if [[ misc/ninjabot.js -nt src/ninjabot-program.js ]]; then
  echo "closure-compiler misc/ninjabot.js -> src/ninjabot-program.js"
  closure-compiler \
    -O=SIMPLE \
    --js=misc/ninjabot.js \
    --js_output_file=misc/.ninjabot.js \
    --language_in=ECMASCRIPT_2018 \
    --language_out=ECMASCRIPT_2018 \
    --env=CUSTOM \
    --module_resolution=NODE \
    --package_json_entry_names=esnext:main,browser,main \
    --assume_function_wrapper \
    --charset=UTF-8 \
    --output_wrapper="$(printf "#!/usr/bin/env node\n%%output%%")"

node <<_JS
let fs = require('fs')
let s = fs.readFileSync("misc/.ninjabot.js", "utf8")

s = "// generated from misc/ninjabot.js by misc/build.sh -- do not edit manually\n" +
    "export default " + require("util").inspect(s) + "\n";

fs.writeFileSync("src/ninjabot-program.js", s, "utf8")
_JS

  rm misc/.ninjabot.js
fi


if $DEBUG; then
  if [ ! -f wasmc.g ]; then
    touch wasmc.g
    chmod +x wasmc.g
  fi
  ./node_modules/.bin/rollup $ROLLUP_ARGS \
    -o wasmc.g \
    --format cjs \
    --sourcemap inline \
    --intro "const WASMC_VERSION='$WASMC_VERSION',DEBUG=true;" \
    --banner '#!/usr/bin/env node' \
    src/main.js

else
  ./node_modules/.bin/rollup $ROLLUP_ARGS \
    -o .wasmc.js \
    --format cjs \
    --sourcemap inline \
    --intro "const WASMC_VERSION='$WASMC_VERSION',DEBUG=false;" \
    --banner '#!/usr/bin/env node' \
    src/main.js

# strip comments
node <<_JS
let fs = require('fs')
let s = fs.readFileSync(".wasmc.js", "utf8")
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
fs.writeFileSync(".wasmc.js", s, "utf8")
_JS

  echo "running closure-compiler"
  closure-compiler \
    -O=SIMPLE \
    --js=.wasmc.js \
    --js_output_file=wasmc \
    --language_in=ECMASCRIPT_2018 \
    --language_out=ECMASCRIPT_2018 \
    --env=CUSTOM \
    \
    --module_resolution=NODE \
    --package_json_entry_names=esnext:main,browser,main \
    --assume_function_wrapper \
    --create_source_map=wasmc.map \
    --source_map_input=".wasmc.js|.wasmc.js.map" \
    \
    --charset=UTF-8 \
    --output_wrapper="$(printf "#!/usr/bin/env node\n%%output%%\n//#sourceMappingURL=wasmc.map")"

  rm .wasmc.js
  chmod +x wasmc
fi
