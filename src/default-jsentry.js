//
// JavaScript wrapper used for modules that do not define a custom jsentry file
//
export default `
// This is the default JS wrapper used when a module does not define jsentry
// in its configuration.

// Exports the functions free and malloc.
// Exports all user C functions which do not being with "_".
let exported = {}

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
exported.ready = Module.ready.then(() => exported)

// dynamically export all but known built-ins
Object.keys(Module).forEach(k => {
  if (k != "_setThrew" &&
      k.charCodeAt(0) == 0x5F &&
      k.charCodeAt(1) != 0x5F // '_'
  ) {
    // export C "mangled" names like "_hello" as "hello", but avoid internal
    // functions like ___wasm_call_ctors and ___cxa_demangle
    exported[k.substr(1)] = Module[k]
  }
})

export default exported
`