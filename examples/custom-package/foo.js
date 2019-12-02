// This file is an ES module.
// We can use ES module import and export here if we want.

// promise that resolves when the module has loaded and is ready.
export const ready = Module.ready

// An example function
export function hello() {
  // Functions exported from the WASM module are available as module-scoped
  // variables prefixed with "_", e.g. _hello, as well as via the Module object.
  // i.e. Module._hello === Module["_hello"] === _hello

  // The DEBUG constant is predefined to true for debug builds and false otherwise.
  // Since wasmc performs dead-code elimination, only the second print call in this
  // example is actually included in the generated javascript.
  if (DEBUG) {
    print("DEBUG is true")
  } else {
    print("DEBUG is false")
  }

  // Compile-time constants are built-in to the generate javascript and defined with
  // the -D flag to wasmc. For example, for this example we set:
  //   -DHELLO_WORLD="[1, 2+5, '3']"
  // Which means all references to the name "HELLO_WORLD" is replaced with the javascript
  // expression "[1, 7, '3']". Notice how the 2+5 was evaluated at compile time.
  print("HELLO_WORLD =", HELLO_WORLD)

  // assert(condition, message?) is available. Its use is stripped from non-debug builds.
  try {
    assert(false, "testing assert()")
  } catch (err) {
    print(err.message)
  }

  // Call out hello function which outputs messages on stdout and stderr
  _hello()

  // addFunctionWasm is helper which allows exposing JavaScript functions at runtime
  // to the WASM module.
  //
  // For functions that are always available, use emscripten --js-library instead.
  // addFunction should be used to add functions dynamically at runtime.
  //
  // This feature is not available if emcc if built with -O3 or higher optimization level.
  // -O2 is the higest level where this feature is still available.
  // This feature also requires at least one of the following flags set in emcc:
  //
  //   -s RESERVED_FUNCTION_POINTERS=3  # "3" is number of calls to addFunction
  //   -s ALLOW_TABLE_GROWTH=1
  //
  // The second argument to addFunction is a return-and-argument type specifier string.
  // The first character denotes the return type; remaining characters specifies argument types.
  // Available type specifiers:
  //
  //  "v" void   (Valid only for the return type)
  //  "i" i32
  //  "j" i64
  //  "f" f32
  //  "d" f64
  //
  if (typeof addFunctionWasm == "function") {
    let f = addFunctionWasm((int1, int2) => {
      print("js function called from WASM with args", int1, int2)
      return int1 * int2
    }, "iii")
    // ... and calling it from the WASM module
    _callJsFunction(f)
  }
}
