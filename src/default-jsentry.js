//
// JavaScript wrapper used for modules that do not define a custom jsentry file
//
export default `
// This is the default JS wrapper used when a module does not define jsentry
// in its configuration.

// dynamically export all except known built-ins.
// Exports all user C functions which do not being with "_".
function updateApi(api) {
  const skip = {
    _setThrew:1,
    _emscripten_stack_init:1,
    _emscripten_stack_get_free:1,
    _emscripten_stack_get_end:1,
    _malloc:1,
    _free:1,
  }
  for (let k in Module) {
    // export C "mangled" names like "_hello" as "hello", but avoid internal
    // functions like ___wasm_call_ctors and ___cxa_demangle
    if (!(k in skip) && k.length > 1 && k[0] == "_" && k[1] != "_") {
      api[k.substr(1)] = Module[k]
    }
  }
  return api
}

// ready is the "module is ready" promise, used when loading the WASM module
// asynchronosly.
//
// Use example:
//
//   import { ready as fooReady } from "foo"
//   fooReady.then(m => console.log("foo module api:", m))
//
// Use example with await:
//
//   import { ready as foo } from "foo"
//   ...
//   async function doThing() {
//     return (await foo).hello()
//   }
//
let exported = {
  ready: Module.ready.then(updateApi)
}
updateApi(exported)
export default exported
`
