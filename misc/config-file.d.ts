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
  out?     :string  // Output JavaScript filename
  jsentry? :string  // JavaScript entry file
  name?    :string  // Name used in generated ninja build file

  // names of libs needed to build this module.
  // The libs sources are linked into the module.
  deps? :string|string[]

  // additional flags to pass to linker (emcc)
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
  target?: "node" | "node-legacy" | "web" | "worker" | null

  // ECMA standard. Defaults to latest == 0 == 8.
  ecma?: 0 | 5 | 6 | 7 | 8

  // Constant values to provide globally in the javascript
  constants?: {[k:string]:ConstantValue}

  // If true, embed the wasm module inside the output javascript file
  embed?: boolean
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
