// promise that resolves when the module has loaded and is ready.
export const ready = Module.ready

export function hello() {
  // Functions exported from the WASM module are available as module-scoped
  // variables prefixed with "_", e.g. _hello, as well as via the Module object.
  // i.e. Module._hello === Module["_hello"] === _hello
  if (DEBUG) {
    console.log("DEBUG is true")
  } else {
    console.log("DEBUG is false")
  }
  console.log("HELLO_WORLD =", HELLO_WORLD)
  _hello()
}
