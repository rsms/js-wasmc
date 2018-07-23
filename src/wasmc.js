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
  esmod: false,
  g:false, debug: false,
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
    -esmod      Generate ES6 module instead of UMD module

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
    // console.log('rollupWrapper =>', r)
    compileBundle(r.code, r.map.toString(), r.exports)
  }).catch(err => {
    if (err.filename && err.line !== undefined) {
      console.error('%s:%d:%d %s',
        err.filename, err.line, err.col, err.message)
    }
    console.error(err.stack || String(err))
    process.exit(1)
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
    })
  })
}


function getEmccFileSource(emccfile) {
  // Module['locateFile']

  let preamble = `
  var Module = {};
  function emptyfun(){}

  try {
    Module['wasmBinary'] = require('fs').readFileSync(__dirname + '/fontkit.wasm')
  } catch(_) {
    /*Module['locateFile'] = function(name) {
      console.log('locateFile %o', name)
      var p = name.lastIndexOf('.')
      var ext = name.substr(p).toLowerCase()
      if (ext == '.wasm') {
        return
      }
    }*/
  }

  // Module['readBinary'] = function(name) {
  //   console.log('readBinary %o', name)
  //   return new Promise((resolve, reject) => {
  //     require('fs').readFile(__dirname + '/fontkit.wasm', (err, buf) => {
  //       if (err) { reject(err) } else { resolve(buf) }
  //     })
  //   })
  // }
  `.replace(/^\s{2}/g, '')

  if (opts.debug) {
    preamble += `
    Module['print'] = function(msg) { console.log('[wasm log] ' + msg) }
    Module['printErr'] = function(msg) { console.error('[wasm err] ' + msg) }
    `.replace(/^\s{4}/g, '')
  } else {
    preamble += `
    function out(){}
    function err(){}
    Module['print'] = emptyfun
    Module['printErr'] = emptyfun
    `.replace(/^\s{4}/g, '')
  }

  let js = fs.readFileSync(emccfile, 'utf8')

  // js += '\nwarnOnce = function(){};'

  return preamble + js
}


const ast = uglify.ast


function mkvardef(nameAndValues) {
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
  return new ast.Var({ definitions })
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
          let argname0 = node.argnames[0].name
          node.argnames = []

          // introduce the same name as a variable with undefined value
          let name = argname0
          node.body.unshift(
            mkvardef([[argname0, null]])
          )
        }

      } else if (node instanceof ast.Toplevel) {
        descend(node, this)
      
      }
      // else console.log(node.TYPE)

      return node
    })
  )
}


function compileBundle(wrapperCode, wrapperMap, exportedNames) {
  const preamble = opts.esmod ? '' :
    '(function(exports){"use strict";\n'

  const postamble = opts.esmod ? '' :
    `})(this,typeof exports!='undefined'?exports:this["${modname}"]={})`

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
      beautify: opts.debug,
      indent_level: 2,
      preamble,
    },
    sourceMap: {
      content: wrapperMap,
    }
  }

  // Explicitly parse source files in order since order matters.
  // Note: uglify.minify takes an unordered object for muliple files.
  let srcfiles = [
    [emccfile, getEmccFileSource(emccfile)],
    [wrapperfile, wrapperCode],
  ]
  options.parse = options.parse || {}
  options.parse.toplevel = null
  for (let [name, source] of srcfiles) {
    options.parse.filename = name
    options.parse.toplevel = uglify.parse(source, options.parse)
    if (name == emccfile && !opts.debug) {
      options.parse.toplevel = transformEmccAST(options.parse.toplevel)
    }
  }

  let r = uglify.minify(options.parse.toplevel, options)

  if (r.error) {
    console.error('uglify error:', r.error)
    return
  }

  fs.writeFileSync(outfile, r.code + postamble, 'utf8')
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
