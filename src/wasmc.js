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
  g:false,  debug: false,
  pretty: false, // when true, pretty-print output. on by default when debug
  esmod: false,
  embed: false,
}

const args = process.argv.splice(2)

// parse args
for (let i = 0; i < args.length; i++) {
  let arg = args[i]
  if (arg[0] == '-') {
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

  usage: wasmc [options] <emccfile> <wrapperfile> <outfile>
  options:
    -h, -help   Show help message and exit
    -g, -debug  Generate more easily debuggable code
    -pretty     Generate pretty code. Implied with -g, -debug.
    -esmod      Generate ES6 module instead of UMD module
    -embed      Embed WASM code in JS file

  `.trim().replace(/^\s\s/gm, ''))
  process.exit(1)
}

if (args.length != 3 || opts.h || opts.help) {
  usage()
}

opts.debug = opts.debug || opts.g

const [emccfile, wrapperfile, outfile] = args
const modname = Path.basename(outfile, Path.extname(outfile))


function main() {
  rollupWrapper(wrapperfile).then(r => {
    // console.log('rollupWrapper =>', r.code)
    compileBundle(r.code, r.map.toString(), r.exports)
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
    // console.log('rollup =>', r)
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
  !opts.debug ? 'err' : null,
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
  return toplevel.transform(new uglify.TreeTransformer(
    function(node, descend, inList) {

      if (node instanceof ast.Var) {

        for (let i = 0; i < node.definitions.length; i++) {
          let def = node.definitions[i]
          if (def.name && stripDefsWithName.has(def.name.name)) {
            // console.log(`strip def %o`, def.name.name)
            node.definitions.splice(i, 1)
            i--
          }
        }

        if (node.definitions.length === 0) {
          return new ast.EmptyStatement()
        }


      } else if (node instanceof ast.Defun && node.name) {
        let name = node.name.name
        if (shouldStripFunNamed(name)) {
          // console.log(`strip fun %o`, name)
          node.argnames = []
          node.body = []
          node.start = undefined
          node.end = undefined
          // console.log(node, descend, inList)
        } else if (name == 'abort') {
          // rewrite abort to ignore argument that's a lengthy
          // message, and replace it with a definition.
          // console.log(node, descend, inList)
          if (node.argnames.length > 0) {
            let argname0 = node.argnames[0].name
            node.argnames = []

            // introduce the same name as a variable with undefined value
            let name = argname0
            node.body.unshift(
              mkvardef(ast.Var, [[argname0, null]])
            )
          }
        }

      } else if (node instanceof ast.Toplevel) {
        return descend(node, this)
      }
      // else console.log(node.TYPE)

      return node
    })
  )
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



  let pre = `

  let IS_NODEJS_LIKE = (
    typeof process === "object" &&
    typeof require === "function"
  )
  let Path, Fs
  if (IS_NODEJS_LIKE) {
    try {
      Path = require('path')
      Fs = require('fs')
    } catch(_) {
      IS_NODEJS_LIKE = false
    }
  }

  // clear module to avoid emcc code to export THE ENTIRE WORLD
  let orig_module
  if (typeof module != 'undefined') {
    orig_module = module
    module = undefined
  }

  function emptyfun(){}

  var Module = {
    preRun: [${preRun}],
    postRun: [${postRun}],

    print(text) {
      console.log.apply(console, Array.prototype.slice.call(arguments))
    },

    printErr(text) {
      console.error.apply(console, Array.prototype.slice.call(arguments))
    },
  }


  Module.ready = new Promise((resolve,reject) => {
    Module.onRuntimeInitialized = () => {
      // console.log('onRuntimeInitialized called')
      asm = Module["asm"] // re-export updated wasm api
      if (typeof define == 'function') {
        define(${JSON.stringify(modname)}, exports)
      }
      resolve()
    }
  })


  if (IS_NODEJS_LIKE) {
    Module.locateFile = function(name) {
      return Path.join(__dirname, name)
    }
  }


  `.trim().replace(/^\s{2}/g, '')

  if (opts.debug) {
    pre += `
    Module['print'] = function(msg) { console.log('[wasm log] ' + msg) };
    Module['printErr'] = function(msg) { console.error('[wasm err] ' + msg) };
    `.trim().replace(/^\s{4}/g, '')
  } else {
    pre += `
    function out(){}
    function err(){}
    Module['print'] = emptyfun;
    Module['printErr'] = emptyfun;
    `.trim().replace(/^\s{4}/g, '')
  }


  if (opts.embed) {
    let wasmfile = (
      emccfile.substr(0, emccfile.length - Path.extname(emccfile).length) +
      '.wasm'
    )
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
  return fs.readFileSync(emccfile, 'utf8')
}


function compileBundle(wrapperCode, wrapperMap, exportedNames) {
  // const emccWrapper = {
  //   pre: 'const asm = (()=>{\n',
  //   post: 'return Module.asm})()',
  // }

  const wrapperStart = opts.esmod ? '' :
    '(function(exports){"use strict";\n'

  const wrapperEnd = opts.esmod ? '' :
    `}).call(this,typeof exports!='undefined'?exports:this["${modname}"]={})`

  const enclosure = getModuleEnclosure(modname)

  let options = {
    toplevel: !opts.debug,
    compress: opts.debug ? false : {
      ecma: 6,
      global_defs: { DEBUG: false },
      passes: 2,
      toplevel: true,
      top_retain: ['exports'],
    },
    mangle: opts.debug ? false : {
      toplevel: true,
    },
    output: {
      ecma: opts.esmod ? 7 : 6,
      beautify: opts.debug || opts.pretty,
      indent_level: 2,
      preamble: wrapperStart,
    },
    sourceMap: {
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
      if (!opts.debug) {
        options.parse.toplevel = transformEmccAST(options.parse.toplevel)
      }
      // options.parse.toplevel = wrapInCallClosure(options.parse.toplevel)
      // options.parse.toplevel = wrapSingleExport(
      //   options.parse.toplevel,
      //   'asm',
      //   'asm'
      // )
    }
  }

  let r = uglify.minify(options.parse.toplevel, options)

  if (r.error) {
    console.error('uglify error:', r.error)
    return
  }

  fs.writeFileSync(outfile, r.code + wrapperEnd, 'utf8')
}


// const w = fs.createWriteStream(outfile)
// w.write(`(function(){"use strict";\n`)

// w.write(emccjs)

// const wrapperjs = 
// w.write(wrapperjs)

// w.write(`})(
//   this,
//   typeof exports != 'undefined' ? exports : this["${modname}"]={}
// )\n`)
// w.end()

main()
