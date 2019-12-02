// This file is an ES module.
// We can use ES module import and export here if we want.
import { call_bar } from "./bar"
import "./bar1"
import {
  call_bar1,
} from "./bar2"
import * as fs from "fs"

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

  // Call our hello functions
  _foo_hello() // outputs a message on stdout
  call_bar()
}
