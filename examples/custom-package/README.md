Demonstrates use of the "package" tool

```
usage: ./build.sh [-O]
-O  Create optimized build
```

1. Compiles WASM module some custom way, not using wasmc.
   In this example emcc is used from a docker image.
2. Uses `wasmc -Tpackage` to create a JS package at build/foo.js

See build.sh for details
