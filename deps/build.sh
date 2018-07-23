#!/bin/bash -e
cd "$(dirname "$0")"
mkdir -p build

# ----------------------------------------------------------------------------
# source-map

VERSION=$(node -p "require('../node_modules/source-map/package.json').version")
echo "/* source-map $VERSION */" > build/source-map.js
echo 'const module = {exports:{}};(function(){' >> build/source-map.js
cat ../node_modules/source-map/dist/source-map.js >> build/source-map.js
echo '}).apply({});' >> build/source-map.js
echo 'export default {' >> build/source-map.js
echo '  SourceMapGenerator: module.exports.SourceMapGenerator,' >> build/source-map.js
echo '  SourceMapConsumer: module.exports.SourceMapConsumer,' >> build/source-map.js
echo '  SourceNode: module.exports.SourceNode,' >> build/source-map.js
echo '}' >> build/source-map.js

# ----------------------------------------------------------------------------
# rollup

VERSION=$(node -p "require('../node_modules/rollup/package.json').version")
echo "/* rollup $VERSION */" > build/rollup.js
echo 'const exports = {};' >> build/rollup.js
cat ../node_modules/rollup/dist/rollup.js >> build/rollup.js
echo 'export default {' >> build/rollup.js
echo '  rollup: exports.rollup,' >> build/rollup.js
echo '  watch: exports.watch,' >> build/rollup.js
echo '  VERSION: exports.VERSION,' >> build/rollup.js
echo '}' >> build/rollup.js

# ----------------------------------------------------------------------------
# uglify-es

uglify_src_files=( \
  utils.js \
  ast.js \
  parse.js \
  transform.js \
  scope.js \
  output.js \
  compress.js \
  sourcemap.js \
  mozilla-ast.js \
  propmangle.js \
  minify.js \
)
VERSION=$(node -p "require('../node_modules/uglify-es/package.json').version")
echo "/* uglify-es $VERSION */" > build/uglify-es.js
echo 'import MOZ_SourceMap from "./source-map.js"' >> build/uglify-es.js
for f in ${uglify_src_files[@]}; do
  cat ../node_modules/uglify-es/lib/$f >> build/uglify-es.js
done
echo 'export default {' >> build/uglify-es.js
echo '  TreeWalker,' >> build/uglify-es.js
echo '  parse,' >> build/uglify-es.js
echo '  TreeTransformer,' >> build/uglify-es.js
echo '  push_uniq, Dictionary,' >> build/uglify-es.js
echo '  minify,' >> build/uglify-es.js
echo '  ast: {' >> build/uglify-es.js
grep -E 'var AST_.+' ../node_modules/uglify-es/lib/ast.js \
  | sort -u \
  | sed -E 's/var AST_([a-zA-Z0-9_]+).+/    \1: AST_\1,/g' >> build/uglify-es.js
echo '  },' >> build/uglify-es.js
echo '}' >> build/uglify-es.js
