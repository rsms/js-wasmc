// environment available when evaluating wasmc config file

// lib defines a collection of source files
declare function lib(sources :string|string[]) :string
declare function lib(props :LibProps) :string

// module defines a WASM module
declare function module(props :ModuleProps) :string

// true when configuring a debug build
declare const debug :boolean

// CLI arguments
declare const argv :string[]

// flags passed to emcc in all cases
declare var flags :string[]

// flags passed to emcc when compiling source files to objects
declare var cflags :string[]

// flags passed to emcc when linking object files into a wasm module
declare var lflags :string[]

// Project root directory
declare var projectdir :string

// build directory
declare var builddir :string


interface ModuleProps {
  out?     :string  // Output JavaScript filename (defaults to `name` with .js file extension)
  outwasm? :string  // Output WASM filename (defaults to `out` with .wasm file extension)
  jsentry? :string  // JavaScript entry file
  name?    :string  // Name used in generated ninja build file

  // names of libs needed to build this module.
  // The libs sources are linked into the module.
  deps? :string|string[]

  // compiler flags for this module, in addition to the top-level cflags
  cflags? :string[]

  // linker flags for this module, in addition to the top-level lflags
  lflags? :string[]

  // defines an anonymous lib and adds it to deps. Supports glob patterns.
  sources? :string|string[]

  // optimize product for specific target.
  // If not defined, the product is portable and adjusts itself at runtime.
  //
  // When target="node" and embed=true, brotli compression is used to produce
  // a smaller product with better start-up performance.
  // This only works in NodeJS v11.7.0 and is enabled only if the NodeJS runtime
  // wasmc is running in is of this version or later. However, if you are targeting
  // older NodeJS versions, set target="node-legacy" (or don't set target= at all)
  // which disables compression.
  //
  target? : "node" | "node-legacy" | "web" | "worker" | null

  // ECMA standard. Defaults to latest == 0 == 8.
  ecma? : 0 | 5 | 6 | 7 | 8

  // Constant values to provide globally in the javascript
  constants? : {[k:string]:ConstantValue}

  // If true, embed the wasm module inside the output javascript file
  embed? : boolean

  // module format. Defaults to "umd". "es" outputs code with import and export statements.
  format? : "umd" | "es"

  // If false or empty string, don't create a source map.
  // If "inline" is set, source map is embedded in the JS (out) file.
  // If a string (other than "inline") is provided, it names the filename for the source map.
  // Relative filenames are relative to projectdir (dirname of your wasmc.js file.)
  // When true, source map is written to `${out}.map`
  // Defaults to true when undefined.
  sourceMap? : boolean | "inline" | string

  // jslib names a JavaScript file to be included as a library with Emscripten/emcc, for
  // providing JavaScript functions to the WASM module.
  // The file named here should at some point declare functions like this:
  //
  //   mergeInto(LibraryManager.library, {
  //     fun_from_js: function(a, b) {
  //       console.log("fun_from_js called from WASM with args:", a, b)
  //     },
  //   })
  //
  // See thee emscripten documentation for more details:
  // https://emscripten.org/docs/porting/connecting_cpp_and_javascript/Interacting-with-code.html
  //
  jslib? : string
}


interface ModulePropsWithSource extends ModuleProps {
  sources :string|string[]

  // additional cflags for compiling the source files with emcc into object files
  cflags? :string[]
}


interface LibProps {
  sources :string|string[]  // Input source files. Supports glob patterns.
  name?   :string           // name used in ninja comments
  cflags? :string[]         // additional cflags
}


type ConstantValue = string
                   | number
                   | boolean
                   | undefined
                   | null
                   | Array<ConstantValue>
                   | {[k:string]:ConstantValue}
