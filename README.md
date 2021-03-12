# wasmc

Simplifies building of WebAssembly modules from C and C++

- Handles compiling, linking and packaging of C and C++ WASM/JS projects
- Zero dependencies -- portable single-file program
- Includes `rollup` and `uglify` functionality, producing very small products


## Usage

```
usage: wasmc [options] [<dir>]
usage: wasmc [-C <dir>] -T<tool> [<tool-arg> ...]
options:
  -debug, -g       Disable optimizations and include data for debuggers.
  -watch, -w       Watch source files and rebuild as needed.
  -config <file>   Load config file from <file> instead of <dir>/wasmc.js
  -image <string>  Docker image to build with instead of rsms/emsdk:1.39.4
  -clean           Rebuild even when product and sources are up to date.
  -quiet, -q       Do not print information to stdout except for warnings and errors
  -help, -h        Show help message and exit
  -C <dir>         Change working directory; as if wasmc was invoked from <dir>.
  -T<tool>         Run <tool> instead of building. -T for list of tools.

<dir>
  The module directory. Defaults to "." (dirname(<file>) with -config)

```

### Example

> See the [`example`](examples/example/) directory for a complete example.

Input `foo.c`:

```c
#include <stdio.h>
export void hello() {
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

Config file `wasmc.js`

```js
module({
  name:    "foo",
  out:     "dist/foo.js",
  jsentry: "foo.js",
  sources: "*.c",
})
```

Build:

```
$ wasmc
```

Generated `dist/foo.js`:

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


### Configuration file

wasmc looks for `wasmc.js` in the project directory and evaluates it.

You can define modules (WASM products) and "libs" (collection of C and/or C++ files
compiled with certain flags) in this file.

- See [`examples/example/wasmc.js`](examples/example/wasmc.js) for an example.
- See [`misc/config-file.d.ts`](misc/config-file.d.ts) for a complete API description of the configuration file.


## Building from source

```
npm install
./misc/build.sh
```

- Release product: `wasmc`
- Debug product: `wasmc.g`
- Build only the debug product: `./misc/build.sh -g`
- Build debug product while watching source files: `./misc/build.sh -w`

