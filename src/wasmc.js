//#!/usr/bin/env node
//
// wasmc -- post-emscripten WASM linker/bundler
//
import rollup from '../deps/build/rollup.js'
import uglify from '../deps/build/uglify-es.js'

const fs = require('fs')
const Path = require('path')

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

  `.trim().replace(/^\s\s/gm, ''))
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

function main() {
  rollupWrapper(wrapperfile).then(r => {
    if (opts.verbose) {
      console.log(`[info] JS exports:`, r.exports.join(', '))
    }
    compileBundle(r.code, r.map.toString()/*, r.exports*/)
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


let stripFunsWithName = new Set([
  !opts.debug ? 'assert' : null,
].filter(v => !!v))

let stripFunsWithPrefix = new Set([
  'nullFunc_',
])

let stripDefsWithName = new Set([
  // !opts.debug ? 'err' : null,
].filter(v => !!v))

function shouldStripFunNamed(name) {
  if (stripFunsWithName.has(name)) {
    return true
  }
  for (let prefix of stripFunsWithPrefix) {
    if (name.startsWith(prefix)) {
      return true
    }
  }
  return false
}


function transformEmccAST(toplevel) {
  let updateAPIFun = null
  let ModuleObj = null
  let apiEntries = new Map()
  let wasmcAbort = null

  const dummyLoc = {file:"<wasmpre>",line:0,col:0}

  let newTopLevel = toplevel.transform(new uglify.TreeTransformer(
    function(node, descend, inList) {

      if (node instanceof ast.Var) {

        for (let i = 0; i < node.definitions.length; i++) {
          let def = node.definitions[i]
          if (!def.name) {
            continue
          }
          if (stripDefsWithName.has(def.name.name)) {
            // console.log(`strip def %o`, def.name.name)
            node.definitions.splice(i, 1)
            i--
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
              let name = def.name.name
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
              def.name.name.startsWith("real_") &&
              def.value.TYPE == "Sub" &&
              def.value.expression.name == "asm"
            ) {
              // e.g. var real__hello = asm["hello"];
              // console.log(def.value.TYPE, def.value.property.value)
              return new ast.EmptyStatement()
            }

          }
        }

        if (node.definitions.length === 0) {
          return new ast.EmptyStatement()
        }


      } else if (
        node instanceof ast.SimpleStatement &&
        node.body instanceof ast.Assign &&
        node.body.operator == "=" &&
        node.body.right.TYPE == "Function" &&
        node.body.left.TYPE == "Sub" && node.body.left.expression.name == "asm"  // asm[PROP]
      ) {
        // e.g.
        //   asm["hello"] = function() {
        //     return real__hello.apply(null, arguments);
        //   };
        return new ast.EmptyStatement()

      } else if (node instanceof ast.Defun && node.name) {
        // Function definition

        let name = node.name.name
        // console.log("FunDef >>", name)

        if (name == '__wasmcUpdateAPI') {
          // Save reference to __wasmcUpdateAPI function (patched later)
          updateAPIFun = node
        } else if (name == "__wasmcAbort") {
          // rename __wasmcAbort -> abort
          node.name.name = "abort"
          wasmcAbort = node
        } else if (name == 'abort' && node !== wasmcAbort) {
          // remove abort implementation from emcc (in favor of __wasmcAbort)
          return new ast.EmptyStatement()
          // Note: info is a variable available in the parent scope
        } else if (!opts.debug && shouldStripFunNamed(name)) {
          // console.log(`strip fun %o`, name)
          // node.argnames = []
          // node.body = []
          // node.start = undefined
          // node.end = undefined
          return new ast.EmptyStatement()
        }

      } else if (node instanceof ast.Toplevel) {
        return descend(node, this)

      } else if (
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


  let pre = `

  var IS_NODEJS_LIKE = (
    typeof process === "object" &&
    typeof require === "function"
  )
  var Path, Fs
  if (IS_NODEJS_LIKE) {
    try {
      Path = require('path')
      Fs = require('fs')
    } catch(_) {
      IS_NODEJS_LIKE = false
    }
  }

  // clear module to avoid emcc code to export THE ENTIRE WORLD
  var orig_module
  if (typeof module != 'undefined') {
    orig_module = module
    module = undefined
  }

  function emptyfun() {}

  function __wasmcAbort(reason) {
    console.error("[wasm] " + (reason.stack || reason));
  }

  function __wasmcUpdateAPI() {}

  var Module = {
    preRun: [${preRun}],
    postRun: [${postRun}],
    print: console.log.bind(console),
    printErr: console.error.bind(console),
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


  if (IS_NODEJS_LIKE) {
    Module.locateFile = function(name) {
      return Path.join(__dirname, name)
    }
  }


  `.trim().replace(/^\s{2}/g, '')

  if (opts.noconsole) {
    pre += `
    function out(){}
    Module['print'] = emptyfun;
    Module['printErr'] = emptyfun;
    `.trim().replace(/^\s{4}/g, '')
  } else if (opts.debug) {
    // prepend module name in debug builds
    pre += `
    Module['print'] = function(msg) { console.log('[${modname}] ' + msg) };
    Module['printErr'] = function(msg) { console.error('[${modname}] ' + msg) };
    `.trim().replace(/^\s{4}/g, '')
  }


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

  // Alias Module.asm as asm for convenience
  // const asm = Module.asm

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


function compileBundle(wrapperCode, wrapperMap /*, exportedNames*/) {
  // const emccWrapper = {
  //   pre: 'const asm = (()=>{\n',
  //   post: 'return Module.asm})()',
  // }

  const wrapperStart = opts.esmod ? '' :
    '(function(exports){"use strict";\n'

  const wrapperEnd = opts.esmod ? '' :
    `})(typeof exports!='undefined'?exports:this["${modname}"]={})`

  const enclosure = getModuleEnclosure(modname)

  let options = {
    ecma,
    toplevel: !opts.debug,
    compress: opts.debug ? false : {
      global_defs: { "DEBUG": false },
      passes: 1,
      toplevel: true,
      top_retain: ['exports'],
      hoist_vars: true,
      keep_classnames: true,
    },
    mangle: false/*opts.debug ? false : {
      toplevel: true,
      keep_classnames: true,
      // reserved: [],
      // keep_quoted: true,
    }*/,
    output: {
      beautify: opts.debug || opts.pretty,
      indent_level: 2,
      preamble: wrapperStart,
    },
    sourceMap: opts.nosourcemap ? false : {
      content: wrapperMap,
    }
  }

  // Explicitly parse source files in order since order matters.
  // Note: uglify.minify takes an unordered object for muliple files.
  let srcfiles = [
    enclosure.pre && ['<wasmcpre>', enclosure.pre],
    [emccfile, getEmccFileSource(emccfile) + enclosure.mid],
    // enclosure.mid && ['<wasmcmid>', enclosure.mid],
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
        content: wrapperMap,
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
