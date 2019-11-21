# wasmc

Post-Emscripten WASM bundler

- Zero dependencies -- portable single-file program
- Includes `rollup` and `uglify` functionality, producing very small products


## Usage

```
usage: wasmc [options] <emccfile> <wrapperfile>
options:
  -h, -help          Show help message and exit
  -v, -verbose       Print extra information to stdout
  -g, -debug         Generate more easily debuggable code
  -o=<file>          Output JS file. Defaults to <emccfile>.
  -esmod             Generate ES6 module instead of UMD module
  -ecma=<version>    ES target version. Defaults to 8 (ES2017). Range: 5–8.
  -embed             Embed WASM code in JS file.
  -syncinit          Load & initialize WASM module on main thread.
                     Useful for NodeJS. May cause issues in web browsers.
  -wasm=<file>       Custom name of wasm file. Defaults to <emccfile-.js>.wasm
  -pretty            Generate pretty code. Implied with -g, -debug.
  -inline-sourcemap  Store source map inline instead of <outfile>.map
  -nosourcemap       Do not generate a source map
  -noconsole         Silence all print calls (normally routed to console)
  -D<name>[=<val>]   Define constant global <name>. <val> defaults to `true`.

Predefined constants: (can be overridden)
  -DDEBUG= `true` when -g or -debug is set, otherwise `false`

```

### Example

> See the [`example`](example/) directory for a complete example.

Input `foo.c`:

```c
#include <emscripten/emscripten.h>
#include <stdio.h>
void EMSCRIPTEN_KEEPALIVE hello() {
  printf("Hello from wasm\n");
}
```

Input `foo.js`:

```js
export const ready = Module.ready
export function hello() {
  _hello() // Call WASM function "hello"
}
```

Build:

```
$ emcc -s WASM=1 foo.c -o build/foo.js
$ wasmc build/foo.js foo.js
```

Generated `build/foo.js`:

```js
(function(exports){
  "use strict";
  // -- emscripten bootstrap code here --
  Object.defineProperty(exports,"__esModule",{value:!0});
  exports.ready = Module.ready;
  exports.hello = function() {
    _hello();
  };
})(typeof exports!='undefined'?exports:this["foo"]={})
//# sourceMappingURL=foo.js.map
```

Run:

```
$ node -e 'require("./out/foo.js").ready.then(m => m.hello())'
Hello from wasm
```



### Asynchronous vs blocking WASM instantiation

WASM initialization is asynchronous by default, which is why we wait for the `ready` promise
in the example above, before calling the hello function.

Sometimes it's desireable to have the module ready right away, like for instance in NodeJS.

`wasmc` can load and initialize the WASM module synchronously using the `-syncinit` flag.
This causes loading of the WASM file, compilation and instantiation all to happen on the
main thread, rather than on a background thread, as is the case normally.

We can amend our example above:

Input `foo.js`:

```js
export function hello() {
  _hello()
}
```

Build:

```
$ emcc -s WASM=1 foo.c -o build/foo.js
$ wasmc -syncinit build/foo.js foo.js
```

Generated `build/foo.js`:

```js
(function(exports){
  "use strict";
  // -- emscripten bootstrap code here --
  Object.defineProperty(exports,"__esModule",{value:!0});
  exports.hello = function() {
    _hello();
  };
})(typeof exports!='undefined'?exports:this["foo"]={})
//# sourceMappingURL=foo.js.map
```

Run:

```
$ node -e 'require("./out/foo.js").hello()'
Hello from wasm
```

Note that you can combine `-syncinit` with the `-embed` flag to embed your WASM binary inside
your output js file. This may be desireable if you want to ship a single JS file.
The `-inline-sourcemap` flag might be of interest as well in that case.


## Building from source

```
npm install
./misc/build.sh
```

- Release product: `wasmc`
- Debug product: `wasmc.g`
- Build only the debug product: `./misc/build.sh -g`
- Build debug product while watching source files: `./misc/build.sh -w`

