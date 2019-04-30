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
  -pretty     Generate pretty code. Implied with -g, -debug.
  -esmod      Generate ES6 module instead of UMD module
  -embed      Embed WASM code in JS file
```

### Example

> See the [`example`](example/) directory for a complete example.

Input `src/foo.js`:

```js
export function hello() {
  Module._hello() // WASM function "hello"
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
// -- emscripten bootstrap code here --
Object.defineProperty(exports,"__esModule",{value:!0});
exports.hello=function(){m._hello()}
}).call(this,typeof exports!='undefined'?exports:this["foo"]={})
```

Run:

```
$ node -e 'require("./out/foo.js").onload.then(m => m.hello())'
[wasm log] Hello from wasm
```

Note that WASM initialization is asynchronous since a separate wasm file
is loaded. This is why we wait for the onload promise above before calling
the hello function.


## Building from source

```
npm install
npm run build
```

- Release product: `wasmc`
- Debug product: `wasmc.g.js`

`npm run build-g` builds only the debug product.
You can also have the build script watch source for changes and automatically
rebuild the debug product: `npm run build-w`
