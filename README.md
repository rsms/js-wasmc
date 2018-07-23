# wasmc

Post-Emscripten WASM bundler

- Zero dependencies -- portable single-file program
- Includes `rollup` and `uglify` functionality, producing very small products


## Usage

```
usage: wasmc [options] <emccfile> <wrapperfile> <outfile>
options:
  -h, -help   Show help message and exit
  -g, -debug  Generate more easily debuggable code
  -esmod      Generate ES6 module instead of UMD module
```

### Example

Input `src/foo.js`:

```js
// "Module" here is a variable holding the namespace of the WASM module
export function hello() {
  Module["_hello"]()
}
```

Build:

```
$ emcc -s WASM=1 src/foo.c -o tmp/foo.js
$ wasmc tmp/foo.js src/foo.js foo.js
$ mv tmp/foo.wasm foo.wasm
```

Generated `foo.js`:

```js
(function(exports){"use strict";
//
// -- emscripten bootstrap code here --
//
Object.defineProperty(exports,"__esModule",{value:!0});
exports.hello=function(){m["_hello"]()}
}).call(this,typeof exports!='undefined'?exports:this["foo"]={})
```

Run:

```
$ node -e "require('./foo.js').hello()"
Hello world
```


## Building from source

```
npm install
npm run build
```

Build debug product `wasmc.g.js`:

```
npm run build-g
```

Watch & rebuild debug product as sources changes:

```
npm run build-w
```
