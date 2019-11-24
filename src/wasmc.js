//#!/usr/bin/env node
//
// wasmc -- post-emscripten WASM linker/bundler
//
import rollup from '../deps/build/rollup.js'
import uglify from '../deps/build/uglify-es.js'

const fs = require('fs')
const Path = require('path')

const assert = DEBUG ? function(condition, message) {
  if (!condition) {
    let e = new Error(message || "assertion failed")
    e.name = "AssertionError"
    throw e
  }
} : function(){}

const opts = {
  h: false, help: false,
  g: false, debug: false,
  v: false, verbose: false,
  pretty: false, // when true, pretty-print output. on by default when debug
  esmod: false,
  embed: false,
  syncinit: false,
  wasm: null,
  "inline-sourcemap": false,
  nosourcemap: false,
  noconsole: false,  // silence all print calls (normally routed to console)
  nostdout: false,   // silence output to stdout (normally routed to console.log)
  nostderr: false,   // silence output to stderr (normally routed to console.error)
  target: null,

  globalDefs: {},  // -Dname=val
}

const args = process.argv.splice(2)

// parse args
for (let i = 0; i < args.length; i++) {
  let arg = args[i]
  if (arg[0] == '-') {
    if (arg[1] == '-') {
      // -- ends arguments
      break
    }
    if (arg.substr(0,2) == '-D') {
      let [k, v] = arg.substr(2).split('=')
      opts.globalDefs[k] = v ? (0,eval)('0||'+v) : true
    } else {
      let [k, v] = arg.replace(/^\-+/, '').split('=')
      if (v === undefined) {
        v = true
      }
      if (!(k in opts)) {
        console.error(`unknown option ${arg.split('=')[0]}`)
        usage()
      } else {
        opts[k] = v
      }
    }
    args.splice(i, 1)
    i--
  }
}

function usage() {
  console.error(`
  wasmc ${WASMC_VERSION} WebAssembly module bundler.
  usage: wasmc [options] <emccfile> <wrapperfile>
  options:
    -h, -help          Show help message and exit
    -v, -verbose       Print extra information to stdout
    -g, -debug         Generate more easily debuggable code
    -o=<file>          Output JS file. Defaults to <emccfile>.
    -esmod             Generate ES6 module instead of UMD module
    -ecma=<version>    ES target version. Defaults to 8 (ES2017). Range: 5–8.
    -embed             Embed WASM code in JS file.
    -syncinit          Load & initialize WASM module on main thread.
                       Useful for NodeJS. May cause issues in web browsers.
    -wasm=<file>       Custom name of wasm file. Defaults to <emccfile-.js>.wasm
    -pretty            Generate pretty code. Implied with -g, -debug.
    -inline-sourcemap  Store source map inline instead of <outfile>.map
    -nosourcemap       Do not generate a source map
    -noconsole         Silence all print calls (normally routed to console)
    -nostderr          Silence output to stdout (normally routed to console.log)
    -nostdout          Silence output to stderr (normally routed to console.error)
    -D<name>[=<val>]   Define constant global <name>. <val> defaults to \`true\`.
    -target=<target>   Build only for <target>. Sets a set of -D definitions to
                       include only code required for the target. Generates
                       smaller output but is less portable.

  Available <target> values:
    node    NodeJS-like environments
    web     Web browser
    worker  Web worker

  Predefined constants: (can be overridden)
    -DDEBUG    \`true\` when -g or -debug is set, otherwise \`false\`

  `.trim().replace(/^  /gm, '') + "\n")
  process.exit(1)
}

if (args.length < 2 || opts.h || opts.help) {
  usage()
}

function die(msg) {
  console.error("wasmc: " + msg)
  console.error(`See wasmc -h for help`)
  process.exit(1)
}

opts.debug = opts.debug || opts.g
opts.verbose = opts.verbose || opts.v
const ecma = opts.ecma ? parseInt(opts.ecma) : 8

if (isNaN(ecma) || ecma < 5 || ecma > 8) {
  die("-ecma requires a number in the range [5-8]")
}
if (opts.embed && opts.wasm) {
  die("Both -embed and -wasm was provided. Pick one.")
}

// Note: <outfile> is secretly suppored for backwards-compatibility
let [emccfile, wrapperfile, outfile] = args
if (!outfile) {
  outfile = opts.o || emccfile
}

const modname = Path.basename(outfile, Path.extname(outfile))


function targetDefs(target) {
  switch (target) {
    case "node": return {
      WASMC_IS_NODEJS_LIKE:  true,
      ENVIRONMENT_IS_WEB:    false,
      ENVIRONMENT_IS_WORKER: false,
      ENVIRONMENT_IS_NODE:   true,
      ENVIRONMENT_HAS_NODE:  true,
      ENVIRONMENT_IS_SHELL:  false,
    }
    case "web": return {
      WASMC_IS_NODEJS_LIKE:  false,
      ENVIRONMENT_IS_WEB:    true,
      ENVIRONMENT_IS_WORKER: false,
      ENVIRONMENT_IS_NODE:   false,
      ENVIRONMENT_HAS_NODE:  false,
      ENVIRONMENT_IS_SHELL:  false,
    }
    case "worker": return {
      WASMC_IS_NODEJS_LIKE:  false,
      ENVIRONMENT_IS_WEB:    false,
      ENVIRONMENT_IS_WORKER: true,
      ENVIRONMENT_IS_NODE:   false,
      ENVIRONMENT_HAS_NODE:  false,
      ENVIRONMENT_IS_SHELL:  false,
    }
    default:
      console.error(`wasmc: invalid -target ${JSON.stringify(target)}`)
      process.exit(1)

    // node    NodeJS-like environments
    // web     Web browser
    // worker  Web worker
  }
}


function main() {
  if (!("DEBUG" in opts.globalDefs)) {
    opts.globalDefs["DEBUG"] = !!opts.debug
  }

  if (opts.target) {
    let defs = targetDefs(opts.target)
    Object.keys(defs).forEach(k => {
      if (!(k in opts.globalDefs)) {
        opts.globalDefs[k] = defs[k]
      }
    })
  }

  rollupWrapper(wrapperfile).then(r => {
    if (opts.verbose) {
      console.log(`[info] JS exports:`, r.exports.join(', '))
    }
    compileBundle(r.code, r.map, r.map.toString()/*, r.exports*/)
  }).catch(err => {
    let file = err.filename || (err.loc && err.loc.file) || null
    let line = err.line || (err.loc && err.loc.line) || 0
    let col = err.col || err.column || (err.loc && err.loc.column) || 0
    if (file) {
      console.error('%s:%d:%d %s', file, line, col, err.message)
      if (err.frame && typeof err.frame == 'string') {
        console.error(err.frame)
      }
    } else {
      console.error(err.stack || String(err), err)
    }
  })
}


function rollupWrapper(wrapperfile) {
  const rollupOptions = {
    input: wrapperfile,
  }
  return rollup.rollup(rollupOptions).then(r => {
    return r.generate({
      format: opts.esmod ? 'es' : 'cjs',
      sourcemap: true,
      // sourcemapFile: 'bob',
      // name: modname,
      // banner: '((Module)=>{',
      // footer: '})()',
    })
  })
}


const ast = uglify.ast


// mkvardef(varcons :{new(props)=>ast.Node}, nameAndValues : string[][])
function mkvardef(varcons, nameAndValues) {
  let definitions = []
  for (let [name, value] of nameAndValues) {
    if (!(name instanceof ast.Symbol)) {
      name = new ast.SymbolVar({
        name: String(name)
      })
    }
    if (value === null && value === undefined) {
      value = null
    } else if (!(value instanceof ast.Node)) {
      value = new ast.String({
        value: String(value),
        quote:'"',
      })
    }
    definitions.push(
      new ast.VarDef({ name, value })
    )
  }
  return new varcons({ definitions })
}


let stripTopLevelFunDefs = new Set([
  // we provide our own versions of these
  'assert',
  'abort',
].filter(v => !!v))

let stripTopLevelFunDefsPrefix = new Set([
  'nullFunc_',
])

const stripTopLevelVarDefs = new Set([
  // we provide our own versions of these
  "out",
  "err",
])

const wasmcSourceFileNames = {
  "<wasmcpre>": 1,
  "<wasmcmid>": 1,
  "<wasmcpost>": 1,
}

// let stripDefsWithName = new Set([
//   // !opts.debug ? 'err' : null,
// ].filter(v => !!v))

function shouldStripTopLevelFunNamed(name, file) {
  if (file in wasmcSourceFileNames) {
    // never strip stuff from our pre and post code
    return false
  }
  if (stripTopLevelFunDefs.has(name)) {
    // console.log(`strip fun ${name} (by name) file ${file}`)
    return true
  }
  for (let prefix of stripTopLevelFunDefsPrefix) {
    if (name.startsWith(prefix)) {
      return true
    }
  }
  return false
}

// set to print debugging info about AST transformation
const DEBUG_AST_TR = DEBUG && false


// [wasmc_imports start]
// let wasmc_imports = null  // :ast.Object|null
// let wasmImportNameMap = new Map()  // maps source names to mangled runtime names
// [wasmc_imports end]


function transformEmccAST(toplevel) {
  let updateAPIFun = null
  let ModuleObj = null
  let apiEntries = new Map()
  let didAddImports = false

  const dummyLoc = {file:"<wasmpre>",line:0,col:0}

  let stack = [toplevel]
  let parent = toplevel
  let dbg = DEBUG_AST_TR ? function() {
    console.log(
      '[tr]' +
      ("                                                        ".substr(0, stack.length * 2)),
      ...arguments
    )
  } : function(){}

  let visited = new Set()

  let newTopLevel = toplevel.transform(new uglify.TreeTransformer(
    function (node, descend1, inList) {
      if (visited.has(node)) {
        return node
      }
      visited.add(node)

      function descend(n, ctx) {
        dbg(`> ${n.TYPE}`)
        stack.push(node)
        parent = node
        let res = descend1(n, ctx)
        stack.pop(node)
        parent = stack[stack.length - 1]
        // dbg(`descend return-from ${n.TYPE}`)
        return res
      }

      // dbg("visit", node.TYPE)

      if (node instanceof ast.Toplevel) {
        return descend(node, this)
      }

      let parentIsToplevel = parent.TYPE == "Toplevel"

      // if (parent.TYPE != "Toplevel") {
      //   dbg("x visit", node.TYPE)

      //   if (
      //     node instanceof ast.SimpleStatement &&
      //     node.body instanceof ast.Assign &&
      //     node.body.operator == "="
      //   ) {
      //     let {right,left} = node.body
      //     if (left.TYPE == "SymbolRef") {
      //       // case: NAME = <right>
      //       if (left.name in opts.globalDefs) {
      //         dbg(`strip use of gdef assignment ${left.name} in ${left.start.file}`,
      //           {parent:parent.TYPE})
      //         return new ast.EmptyStatement()
      //       }
      //     }
      //   }

      //   return node
      // }

      // [wasmc_imports start]
      // if (parentIsToplevel && node instanceof ast.Const) {
      //   if (node.start && node.start.file == "<wasmcpre>") {
      //     for (let i = 0; i < node.definitions.length; i++) {
      //       let def = node.definitions[i]
      //       if (!def.name) {
      //         continue
      //       }
      //       let name = def.name.name
      //       if (name == "wasmc_imports") {
      //         assert(def.value.TYPE == "Object")
      //         wasmc_imports = def.value
      //       }
      //     }
      //   }
      // } else
      // [wasmc_imports end]

     if (parentIsToplevel && node instanceof ast.Var) {

        for (let i = 0; i < node.definitions.length; i++) {
          let def = node.definitions[i]
          if (!def.name) {
            continue
          }
          let name = def.name.name

          if (name in opts.globalDefs) {
            // overridden by -D flag -- remove local definition in favor of global definition
            dbg(`strip var def ${name} in ${def.start.file} (global override)`)
            node.definitions.splice(i, 1)

          } else if (stripTopLevelVarDefs.has(name)) {
            dbg(`strip var def ${name} in ${def.start.file} (wasmc)`)
            return new ast.EmptyStatement()

          // [wasmc_imports start]
          // } else if (name == "asmLibraryArg") {
          //   if (def.value.TYPE != "Object") {
          //     console.error(`wasmc: please report this issue: asmLibraryArg.TYPE!=Object`)
          //   } else if (!didAddImports) {
          //     dbg("populate wasmImportNameMap")
          //     wasmImportNameMap.clear()
          //     for (let n of def.value.properties) {
          //       if (n.value.TYPE == "SymbolRef" && n.value.name[0] == "_") {
          //         wasmImportNameMap.set(n.value.name.substr(1), n.key)
          //       }
          //     }
          //     def.value.properties.push(new ast.Expansion({
          //       expression: new ast.SymbolVar({ name: "wasmc_imports" })
          //     }))
          //     didAddImports = true
          //   }
          // [wasmc_imports end]

          // } else if (stripDefsWithName.has(name)) {
          //   // console.log(`strip def`, name)
          //   node.definitions.splice(i, 1)
          } else {
            // Pattern of asm route:
            //
            // var _foo = Module["_foo"] = function() {
            //   assert(runtimeInitialized, "msg");
            //   assert(!runtimeExited, "msg");
            //   return Module["asm"]["_foo"].apply(null, arguments);
            // }
            //
            // rewrite as:
            //
            // var _foo = Module["_foo"] = Module["asm"]["_foo"];
            //
            // which, when building optimized builds, maps from WASM mangled
            // names to api name, e.g
            //
            // var _foo = Module["_foo"] = Module["asm"]["a"];
            //

            if (
              def.value &&
              def.value.operator == '=' &&
              def.value.right instanceof ast.Function &&
              def.value.left.TYPE == "Sub" &&
              def.value.left.expression.name == "Module"
            ) {
              // case: var PROP = Module[PROP] = function() { ... }
              let f = def.value.right
              let lastStmt = f.body[f.body.length-1]
              if (lastStmt instanceof ast.Return &&
                  lastStmt.value instanceof ast.Call &&
                  lastStmt.value.expression instanceof ast.Dot)
              {
                if (!apiEntries.has(name)) {
                  let mangledName = (
                    lastStmt.value.expression.property == 'apply' ?
                      lastStmt.value.expression.expression.property.value :
                      lastStmt.value.expression.property.value
                  )

                  if (!(def.value.left instanceof ast.Sub)) {
                    // Sanity check -- expected "Module["_foo"]"
                    // In case emcc changes its output, we'll know.
                    throw new Error(`Module["${name}"] not found`)
                  }

                  apiEntries.set(name, {
                    wasm:   mangledName,
                    sym:    def.name,
                    expr:   lastStmt.value.expression.expression,
                    modsub: def.value.left,
                  })
                }
                if (name != "___wasm_call_ctors") {
                  // strip
                  return new ast.EmptyStatement()
                }
              }
            } else if (
              name.startsWith("real_") &&
              def.value.TYPE == "Sub" &&
              def.value.expression.name == "asm"
            ) {
              // e.g. var real__hello = asm["hello"];
              // dbg(def.value.TYPE, def.value.property.value)
              return new ast.EmptyStatement()
            }

          }
        }

        if (node.definitions.length === 0) {
          return new ast.EmptyStatement()
        }
      }  // if parentIsToplevel && node instanceof ast.Var


      else if (
        node instanceof ast.SimpleStatement &&
        node.body instanceof ast.Assign &&
        node.body.operator == "="
      ) {
        // assignment
        let {right,left} = node.body

        if (
          parentIsToplevel &&
          left.TYPE == "Sub" &&
          left.expression.name == "asm" &&
          right.TYPE == "Function"
        ) {
          // e.g.
          //   asm["hello"] = function() {
          //     return real__hello.apply(null, arguments);
          //   };
          return new ast.EmptyStatement()
        }

        if (left.TYPE == "SymbolRef") {
          // case: NAME = <right>
          if (left.name in opts.globalDefs) {
            // overridden by -D flag -- remove local definition in favor of global definition
            // dbg(`strip use of gdef assignment ${left.name} in ${left.start.file}`,
            //   {parent:parent.TYPE})
            if (DEBUG && parent.TYPE != "Toplevel") {
              console.log("TODO: transformer: gdef assignment sub at non-top level")
            }
            return new ast.EmptyStatement()
          }
        }
      }  // assignment


      else if (parentIsToplevel && node instanceof ast.Defun && node.name) {
        // Function definition

        let name = node.name.name
        // console.log("FunDef >>", name)

        if (name == '__wasmcUpdateAPI') {
          // Save reference to __wasmcUpdateAPI function (patched later)
          updateAPIFun = node
        } else if (shouldStripTopLevelFunNamed(name, node.start && node.start.file)) {
          // console.log(`strip fun`, name, node.start)
          // node.argnames = []
          // node.body = []
          // node.start = undefined
          // node.end = undefined
          return new ast.EmptyStatement()
        }
      } // top-level defun with name, e.g. function foo() { ... }


      else if (
        parentIsToplevel &&
        node instanceof ast.If &&
        node.condition.operator == "!" &&
        node.condition.expression.TYPE == "Call" &&
        node.condition.expression.expression.property == "getOwnPropertyDescriptor" &&
        node.condition.expression.args.length > 1 &&
        node.condition.expression.args[0].TYPE == "SymbolRef" &&
        node.condition.expression.args[0].name == "Module"
      ) {
        // Strip
        // if (!Object.getOwnPropertyDescriptor(Module, "ENV")) Module["ENV"] = function() {
        //   abort("'ENV' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS");
        // };
        return new ast.EmptyStatement()
      }
      // else console.log(node.TYPE)

      return node
      // return descend(node, this)

    }) // uglify.TreeTransformer
  ) // newTopLevel = toplevel.transform


  // Generate var definitions for all WASM API exports.
  // These are later assigned.
  let defs = [], nullnode = new ast.Undefined()
  let defmap = new Map()
  for (let [name, ent] of apiEntries) {
    let def = new ast.VarDef({
      name: ent.sym,
      value: null,
    })
    defmap.set(name, def)
    defs.push(def)
    // ent.sym.reference({})
  }
  newTopLevel.body.unshift(
    new ast.Var({ definitions: defs })
  )

  if (apiEntries.size == 0) {
    console.warn(`[warn] no WASM functions found -- this might be a bug`)
  }

  // console.time("figure_out_scope()")
  // newTopLevel.figure_out_scope()
  // console.timeEnd("figure_out_scope()")
  // // console.log(Object.keys(newTopLevel))
  // console.log("_hello:", newTopLevel.variables._values["$_hello"].references.length)
  // // newTopLevel.variables._values["$_malloc"].references[0].TYPE == SymbolRef
  // // console.log("_malloc:", newTopLevel.variables._values["$_malloc"].references.length)
  // // console.log("_setThrew:", newTopLevel.variables._values["$_setThrew"])

  // add wasm api assignments to __wasmcUpdateAPI function
  for (let [name, ent] of apiEntries) {
    // ent.sym.thedef = defmap.get(ent.sym.name).name
    // if (ent.sym.name == "_hello") {
    //   console.log("ent.sym", ent.sym)
    // }
    // ent.sym.reference()

    // e.g. Module["_foo"] = _foo = Module["asm"]["A"]

    // ent.sym.thedef = defmap.get(ent.sym.name).name
    // let sym = defmap.get(ent.sym.name).name

    // ent.sym.reference({})

    // let stmt = new ast.SimpleStatement({
    //   body: new ast.Assign({
    //     operator: "=",
    //     left: ent.sym,
    //     right: ent.expr,
    //   })
    // })
    // updateAPIFun.body.push(stmt)

    updateAPIFun.body.push(new ast.SimpleStatement({
      body: new ast.Assign({
        operator: "=",
        left: ent.modsub,
        right: new ast.Assign({
          operator: "=",
          left: ent.sym,
          right: ent.expr,
        }),
      })
    }))
  }

  if (opts.verbose) {
    let names = []
    for (let [name, ent] of apiEntries) {
      names.push(name)
    }
    console.log(`[info] WASM functions: ${names.join(', ')}`)
  }

  return newTopLevel
}


function wrapInCallClosure0(node) {
  let body = node.body
  node.body = [
    new ast.SimpleStatement({
      body: new ast.Call({
        args: [],
        expression: new ast.Arrow({
          argnames: [],
          uses_arguments: false,
          is_generator: false,
          async: false,
          body: body,
        }),
      })
    })
  ]
  return node
}


function wrapInCallClosure(node) {
  return node.transform(new uglify.TreeTransformer(
    function(n, descend, inList) {
      if (n === node) {
        return wrapInCallClosure0(n)
      }
      return n
    })
  )
}


function wrapSingleExport(node, localName, exportName) {
  // example
  // input:
  //   var localName = 1
  // output:
  //   var exportName = (() => {
  //     var localName = 1
  //     return localName
  //   })()
  //
  node.body.push(
    new ast.Return({
      value: new ast.SymbolVar({ name: localName })
    })
  )

  wrapInCallClosure0(node)

  node.body[0] = mkvardef(ast.Const, [
    [exportName, node.body[0]]
  ])

  return node
}


// function debugAST(toplevel) {
//   return toplevel.transform(new uglify.TreeTransformer(
//     function(node, descend, inList) {
//       if (node instanceof ast.Toplevel) {
//         descend(node, this)

//         // return wrapSingleExport(node, 'asm', 'asmz')

//         node.body.push(
//           new ast.Return({
//             value: new ast.SymbolVar({ name: 'asm' })
//           })
//         )
//         return mkvardef(ast.Var, [
//           ['asmz', wrapInCallClosure0(node)]
//         ])

//         return node
//       }
//       console.log(node.TYPE)
//       // if (node instanceof ast.Directive) {
//       //   return descend(node, this)
//       // }
//       if (node instanceof ast.Defun || node instanceof ast.SymbolDefun) {
//         return descend(node, this)
//       }
//       if (node instanceof ast.Return) {
//         console.log(node)
//         return descend(node, this)
//       }
//       return node
//     })
//   )
// }


// [wasmc_imports start]
/*function transformUserAST(userfile, toplevel) {
  let error = false
  let visited = new Set()

  function reportError(msg, pos) {
    // TODO: look up original source location via `map` (source map object) provided
    // to compileBundle.
    console.error(`${pos.file}:${pos.line}:${pos.col}: ${msg}`)
    error = true
  }

  if (!wasmc_imports) {
    console.error(`wasmc: please report this issue: wasmc_imports==null at transformUserAST`)
    return null
  }

  const wasmImportFunName = "wasm_function"

  let n = toplevel.transform(new uglify.TreeTransformer(function (node, descend, inList) {
    if (visited.has(node)) {
      return node
    }
    visited.add(node)

    if (node.TYPE == "Toplevel") {
      return descend(node, this)
    }

    if (!node.start || node.start.file != userfile) {
      return node
    }


    function visitCall(node, localname) {
      if (node.expression.TYPE != "SymbolRef" || node.expression.name != wasmImportFunName) {
        return null
      }
      let nargs = node.args.length
      if (nargs != 2) {
        reportError(`${wasmImportFunName} expects exactly 2 arguments (got ${nargs})`, node.start)
        return null
      }

      let namen = node.args[0]
      if (namen.TYPE != "String") {
        reportError(
          `first argument to ${wasmImportFunName} must be a string constant (got ${namen.TYPE})`,
          namen.start || node.start
        )
        return null
      }

      let name = namen.value
      let fun = node.args[1]

      if (!localname) {
        localname = "__wasm_import__" + name.replace(/[^a-zA-Z0-9_]/g, "_")
      }

      if (fun.TYPE != "Function" && fun.TYPE != "Arrow") {
        reportError(
          `second argument to ${wasmImportFunName} must be a function expression`,
          fun.start || node.start
        )
        return null
      }

      if (fun.is_generator) {
        reportError(
          `${wasmImportFunName} does not support generator functions`,
          fun.start || node.start
        )
        return null
      }

      if (fun["async"]) {
        reportError(
          `${wasmImportFunName} does not support async functions`,
          fun.start || node.start
        )
        return null
      }

      wasmc_imports.properties.push(new ast.ObjectKeyVal({
        quote: '"',
        key: wasmImportNameMap.get(name) || name,
        value: new ast.SymbolVar({ name: localname }),
      }))

      return new ast.Defun({
        name: new ast.SymbolDeclaration({
          name: localname
        }),
        argnames: fun.argnames,
        uses_arguments: fun.uses_arguments,
        is_generator: false,
        "async": false,
        body: fun.body,
        start: fun.start,
        end: fun.end,
      })
    }


    if (node.TYPE == "Let" || node.TYPE == "Var" || node.TYPE == "Const") {
      for (let i = 0; i < node.definitions.length; i++) {
        let def = node.definitions[i]
        if (def.value.TYPE == "Call") {
          let n = visitCall(def.value, def.name.name)
          if (n) {
            if (node.definitions.length != 1) {
              reportError(`use of ${wasmImportFunName} as expression is not supported`, def.start)
              return node
            }
            return n
          }
        }
      }
    }

    if (node.TYPE == "SimpleStatement" && node.body.TYPE == "Call") {
      return visitCall(node.body) || node
    }

    return node
  })) // newTopLevel = toplevel.transform
  return error ? null : n
}*/
// [wasmc_imports end]


function getModuleEnclosure(modname) {

  let preRun = '', postRun = ''

  // let performTiming = opts.debug
  // if (performTiming) {
  //   let label = JSON.stringify(modname + ' module-init')
  //   preRun = `()=>{console.time(${label})}`
  //   postRun = `()=>{console.timeEnd(${label})}`
  // }


  // snippet added to Module when -syncinit is set
  let instantiateWasm = opts.syncinit ? `
    instantiateWasm(info, receiveInstance) {
      let instance = new WebAssembly.Instance(new WebAssembly.Module(getBinary()), info)
      receiveInstance(instance)
      return instance.exports
    },
  `.trim().replace(/^\s\s/g, '') : ""


  let pre = ""

  if (opts.debug) {
    // define globals as variables
    pre += "const " + Object.keys(opts.globalDefs).map(k =>
      `${k} = ${JSON.stringify(opts.globalDefs[k])}`
    ).join(",") + ";\n"
  }

  let printJs = (
    opts.noconsole ? `emptyfun` :
    opts.debug     ? `console.log.bind(console,'[${modname}]')` :
                     `console.log.bind(console)`
  )
  let printErrJs = (
    opts.noconsole ? `emptyfun` :
    opts.debug     ? `console.error.bind(console,'[${modname}]')` :
                     `console.error.bind(console)`
  )

  let abortFunJs = (
    opts.debug ? `function abort(e) { throw new Error("wasm abort: "+(e.stack||e)) }` :
                 `function abort() { throw new Error("wasm abort") }`
  )

  let assertFunJs = (
    opts.debug ? `
    function assert(condition, message) {
      if (!condition) {
        let e = new Error(message || "assertion failed")
        e.name = "AssertionError"
        throw e
      }
    }
    `.trim().replace(/^\s{4}/g, '') :
    `function assert() {}`
  )


  pre += `

  var WASMC_IS_NODEJS_LIKE = (
    typeof process === "object" &&
    typeof process.versions === "object" &&
    typeof process.versions.node === "string" &&
    typeof require === "function"
  )
  let PathModule
  if (WASMC_IS_NODEJS_LIKE) {
    try { PathModule = require('path') } catch(_) {}
  }

  // clear module to avoid emcc code to export THE ENTIRE WORLD
  var orig_module
  if (typeof module != 'undefined') {
    orig_module = module
    module = undefined
  }

  function emptyfun() {}
  ${abortFunJs}
  ${assertFunJs}

  function __wasmcUpdateAPI() {}

  var Module = {
    preRun: [${preRun}],
    postRun: [${postRun}],
    print:    ${printJs},
    printErr: ${printErrJs},
    ${instantiateWasm}
  }

  Module.ready = new Promise(resolve => {
    Module.onRuntimeInitialized = () => {
      __wasmcUpdateAPI()
      if (typeof define == 'function') {
        define(${JSON.stringify(modname)}, exports)
      }
      resolve(exports)
    }
  })

  if (WASMC_IS_NODEJS_LIKE && PathModule) {
    Module.locateFile = function(name) {
      return PathModule.join(__dirname, name)
    }
  }


  // make print function available in module namespace
  const print = ${opts.noconsole ? "emptyfun" : `Module.print`};
  const out = ${opts.nostdout ? "emptyfun" : `print`};
  const err = ${(opts.noconsole || opts.nostderr) ? "emptyfun" : `Module.printErr`};

  `.trim().replace(/^\s{2}/g, '') + "\n"

  // wasmc_imports was an attempt at providing a better API than emscripten's
  // --js-library for declaring WASM imports.
  //
  // // populated by wasm_function
  // const wasmc_imports = {}
  // // catch misuse
  // function wasm_function(name, f) {
  //  throw new Error("wasm_function can only be used at the top level of a JS module")
  // }


  if (opts.embed) {
    let wasmfile = emccfile.substr(0, emccfile.length - Path.extname(emccfile).length) + '.wasm'
    let wasmbuf = fs.readFileSync(wasmfile)
    pre += 'Module["wasmBinary"] = new Uint8Array(['
    for (let i = 0; i < wasmbuf.length; i++) {
      let s = wasmbuf[i].toString(10)
      if (i > 0) {
        pre += ',' + s
      } else {
        pre += s
      }
    }
    pre += ']);'
  }


  let mid = `

  Module.inspect = () => "[asm]"

  // Restore temporarily nulled module variable
  if (orig_module !== undefined) {
    module = orig_module
    orig_module = undefined
  }

  `.trim().replace(/^\s{2}/g, '')


  let post = ``

  return { pre, mid, post }
}


function getEmccFileSource(emccfile) {
  let js = fs.readFileSync(emccfile, 'utf8')
  if (opts.wasm) {
    let m = /(?:var|const|let)\s*wasmBinaryFile\s*=\s*(?:'([^']+)'|"([^"]+)");?/g.exec(js)
    if (!m) {
      throw new Error(`wasmc failed to find wasmBinaryFile in EMCC output file ${emccfile}`)
    }
    js = (
      js.substr(0, m.index) +
      `var wasmBinaryFile = ${JSON.stringify(opts.wasm)}` +
      js.substr(m.index + m[0].length)
    )
  }
  return js
}


function compileBundle(wrapperCode, map, wrapperMapJSON /*, exportedNames*/) {

  let wrapperStart = opts.esmod ? '' :
    `(function(exports){"use strict";\n`

  const wrapperEnd = opts.esmod ? '' :
    `})(typeof exports!='undefined'?exports:this["${modname}"]={})`

  const enclosure = getModuleEnclosure(modname)

  let pretty = opts.pretty || opts.debug

  let options = {
    ecma,
    toplevel: !opts.debug,
    compress: opts.debug ? false : {
      global_defs: opts.globalDefs,
      passes: 2,
      toplevel: true,
      top_retain: ['exports'],
      hoist_vars: true,
      keep_classnames: true,
      dead_code: true,
      evaluate: true,
      drop_console: opts.noconsole,
      pure_funcs: [
        "getNativeTypeSize",
      ],
    },
    mangle: pretty ? false : {
      toplevel: true,
      keep_classnames: true,
      // reserved: [],
      // keep_quoted: true,
    },
    output: {
      beautify: pretty,
      indent_level: 2,
      preamble: wrapperStart,
    },
    sourceMap: opts.nosourcemap ? false : {
      content: wrapperMapJSON,
    }
  }

  // Explicitly parse source files in order since order matters.
  // Note: uglify.minify takes an unordered object for muliple files.
  let srcfiles = [
    enclosure.pre && ['<wasmcpre>', enclosure.pre],
    [emccfile, getEmccFileSource(emccfile)],
    enclosure.mid && ['<wasmcmid>', enclosure.mid],
    [wrapperfile, wrapperCode],
    enclosure.post && ['<wasmcpost>', enclosure.post],
  ].filter(v => !!v)

  options.parse = options.parse || {}
  options.parse.toplevel = null
  for (let [name, source] of srcfiles) {
    options.parse.filename = name
    options.parse.toplevel = uglify.parse(source, options.parse)
    if (name == emccfile) {
      options.parse.toplevel = transformEmccAST(options.parse.toplevel)
      // options.parse.toplevel = wrapInCallClosure(options.parse.toplevel)
      // options.parse.toplevel = wrapSingleExport(
      //   options.parse.toplevel,
      //   'asm',
      //   'asm'
      // )
    }

    // [wasmc_imports start]
    // else if (name == wrapperfile) {
    //   let toplevel2 = transformUserAST(wrapperfile, options.parse.toplevel)
    //   if (!toplevel2) {
    //     // There were errors
    //     process.exit(1)
    //   }
    //   options.parse.toplevel = toplevel2
    // }
    // [wasmc_imports end]
  }

  let r
  if (!opts.debug) {
    // roundtrip transformed code since there's either a bug in uglify-es with scope
    // resolution, or I just can't figure out how to make it see references to vars.
    r = uglify.minify(options.parse.toplevel, {
      toplevel: true,
      compress: false,
      mangle: false,
      output: {},
      sourceMap: opts.nosourcemap ? false : {
        content: wrapperMapJSON,
      }
    })
    r = uglify.minify({ a: r.code }, {
      ...options,
      sourceMap: opts.nosourcemap ? false : {
        content: r.map,
      }
    })
  } else {
    r = uglify.minify(options.parse.toplevel, options)
  }

  if (r.error) {
    console.error('uglify error:', r.error)
    return
  }

  let code = r.code + wrapperEnd

  // source map
  if (!opts.nosourcemap) {
    let map = JSON.parse(r.map)
    delete map.sourcesContent
    map.sourceRoot = ".."
    let maps = JSON.stringify(map)

    let mapurl = ""
    if (opts["inline-sourcemap"]) {
      mapurl = (
        "data:application/json;charset=utf-8;base64," +
        Buffer.from(maps, "utf8").toString("base64")
      )
    } else {
      mapurl = Path.basename(outfile + ".map")
      fs.writeFileSync(outfile + ".map", maps, 'utf8')
    }
    code += `\n//# sourceMappingURL=${mapurl}\n`
  }

  fs.writeFileSync(outfile, code, 'utf8')
}


main()
