export const onload = new Promise(resolve =>
  // Functions in Module.postRun are called when the WASM module
  // finish initializing.
  Module.postRun.push(() => resolve(exports))
)

export function hello() {
  // Functions exported from the WASM module are available
  // on the Module object.
  Module["_hello"]()
}
