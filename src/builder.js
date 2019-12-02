import { assert, dlog, statSync, writefile, stripext, monotime, fmtduration, repr } from "./util"
import { NinjaBot } from "./ninjabot"
import { packageModule, gen_WASM_DATA } from "./cmd_package"
import { scanmod } from "./scansource"
import { hashWasmAPI } from "./scanwasm"
import { configure } from "./configure"

const fs = require("fs")
const Path = require("path")

const kSourceInfoPromise = Symbol("kSourceInfoPromise")

let ninjaBotInstances = new Map()  // projectdir => NinjaBot

// build compiles one or more wasmc modules
//
// What this function does:
// 1. Spawns a process to scan for source files
// 2. Runs minja to compile wasm sources
// 3. Runs package to process and compile JS sources
//
// It does these things as needed, unless c.force is set.
//
export async function build(c, allmodules /* = c.config.modules*/ ) { // :Promise<didBuild:bool>
  let startTime = monotime()

  if (!allmodules) {
    allmodules = c.config.modules
  }

  const projectdir = c.config.projectdir
  assert(projectdir == Path.resolve(projectdir), "projectdir not absolute")


  // scan sources to find modules that needs to be built
  // Sets m[kSourceInfoPromise] on modules.
  let { dirtyWasmModsP, dirtyJsModsP } = modsToBuild(c, allmodules)


  // ninja build
  let didBuild = false
  let dirtyWasmMods = allmodules
  if (!c.force && !c.config.didConfigure && !ninjaBotInstances.has(projectdir)) {
    // in this case, make sure we only build what is neccessary
    dirtyWasmMods = await dirtyWasmModsP
  }
  if (dirtyWasmMods.length > 0) {
    dlog(">> build/ninja", dirtyWasmMods.map(m => m.name))
    let targets = dirtyWasmMods.map(m => m.wasmfile)
    let builddirabs = Path.resolve(projectdir, c.config.builddir)
    let ninja = getNinjaBot(c, projectdir)
    didBuild = await ninja.build(builddirabs, targets, /*clean*/c.force)
    if (!didBuild) {
      dirtyWasmMods = []
    }
  } else if (c.watch) {
    // warm up ninjabot
    getNinjaBot(c, projectdir)
  }

  // decide which modules to package
  let dirtyJsMods = allmodules
  let packagemods = allmodules
  if (!c.force && !c.config.didConfigure) {
    dirtyJsMods = await dirtyJsModsP
    packagemods = Array.from(new Set(dirtyWasmMods.concat(dirtyJsMods)))
  }

  let updatedmods = []

  // package
  if (packagemods.length > 0) {
    dlog(">> build/package", packagemods.map(m => m.name))
    await Promise.all(packagemods.map(m => {
      let didBuild = dirtyWasmMods.includes(m)
      let jsSourcesChanged = dirtyJsMods.includes(m)
      return packagemod(c, m, didBuild, jsSourcesChanged).then(didBuild => {
        if (didBuild) {
          updatedmods.push(m)
        }
      })
    }))
  }

  // log
  if (updatedmods.length > 0) {
    let names = updatedmods.map(m => m.name).join(", ")
    ;(c.watch ? c.logImportant : c.log)(
      "Built %s in %s", names, fmtduration(monotime() - startTime)
    )
  } else if (c.watch) {
    let names = allmodules.map(m => m.name).join(", ")
    c.logImportant("Checked %s in %s", names, fmtduration(monotime() - startTime))
  }

  // modules that were built and/or packaged
  return updatedmods
}


export async function buildIncrementally(c) {
  // type flags
  const
    T_WASM = 1,
    T_JS   = 2;

  let rebuildPromise = null
  let dirWatchers = new Map() // dir => DirWatcher
  let queuedForRebuild = new Set() // modules queued for immediate rebuild

  watchConfigFile()

  await rebuild(c.config.modules, /* isFirstBuild */ true)

  c.log("Watching sources for changes.")
  c.force = false


  function watchConfigFile() {
    let isConfiguring = false

    async function reconfigure() {
      if (isConfiguring) {
        return
      }
      isConfiguring = true
      let config = configure(c, c.config.file, c.config.projectdir, c.config.argv)
      if (config.didConfigure) {
        let js1 = JSON.stringify({...c.config, didConfigure:true})
        let js2 = JSON.stringify(config)
        if (js1 != js2) {
          c.log(`config file changed; wrote %s`, c.config.ninjafile)
          stopAllFSWatchers()
          if (rebuildPromise) {
            // wait for any ongoing build to complete
            await rebuildPromise
          }

          // update config
          c.config = config

          // restart build
          await rebuild(c.config.modules, /* isFirstBuild */ true)
        }
      }
      isConfiguring = false
    }

    // watch config file for changes
    fs.watch(c.config.file, (event, filename) => {
      // dlog("config file fs event", event, Path.relative(c.config.projectdir, c.config.file))
      reconfigure()
    })
  }


  function rebuild(modules, isFirstBuild) {
    // rebuildPromise joins multiple calls to rebuild
    if (rebuildPromise) {
      dlog("enqueued rebuild", modules.map(m => m.name))
      for (let m of modules) {
        queuedForRebuild.add(m)
      }
    } else {
      rebuildPromise = _rebuild(modules, isFirstBuild).then(() => {
        rebuildPromise = null
        if (queuedForRebuild.size > 0) {
          let modules2 = Array.from(queuedForRebuild)
          queuedForRebuild.clear()
          dlog("dequeue rebuild", modules2.map(m => m.name))
          return rebuild(modules2)
        }
      })
    }
    return rebuildPromise
  }


  async function _rebuild(modules, isFirstBuild) {
    try {
      if (!isFirstBuild) {
        c.logImportant("Rebuilding %s", modules.map(m => m.name))
      }
      let updatedmods = await build(c, modules)
      dlog({updatedmods: updatedmods.map(m => m.name)})
    } catch (err) {
      if (err == "ninja error") {
        c.error("build failed")
      } else {
        c.error("build failed: %s", err.stack || err)
      }
    }
    return updateSources(modules, isFirstBuild)
  }


  function stopAllFSWatchers() {
    for (let w of dirWatchers.values()) {
      w.close()
    }
    dirWatchers.clear()
  }


  let fsEventChangeTimer = null
  let fsEventChangeSet = new Set() // DirmapEntry{ m: Mod, typeflags: T_* }


  function flushDirFSEvents() {
    dlog("flushDirFSEvents")
    let modules = []
    for (let ent of fsEventChangeSet) {
      modules.push(ent.m)
    }
    if (DEBUG && modules.length != (new Set(modules)).size) {
      dlog(`duplicate modules in`, {modules})
    }
    fsEventChangeSet.clear()
    rebuild(modules)
  }


  function onDirFSEvent(dirmap, dir, event, filename) {
    if (!/\.(?:js|c|cc|cpp|c\+\+|h|hh|hpp|h\+\+|inc)$/.test(filename)) {
      return
    }
    clearTimeout(fsEventChangeTimer)
    fsEventChangeTimer = setTimeout(flushDirFSEvents, 50)
    for (let ent of dirmap.get(dir)) {
      fsEventChangeSet.add(ent)
    }
  }


  async function updateSources(modules, isFirstBuild) {
    // TODO something smarter here where we keep watchers around
    stopAllFSWatchers()

    let dirmap = await buildDirMap(modules)
    dlog("dirmap:", dirmap)

    for (let [dir, ents] of dirmap) {
      let w = fs.watch(dir, onDirFSEvent.bind(null, dirmap, dir))
      dirWatchers.set(dir, w)
    }
  }


  async function buildDirMap(modules) {
    let dirmap = new Map()  // source directory => Mod[]

    for (let m of modules) {
      let sourceInfo = await m[kSourceInfoPromise]
      // sourceInfo = {
      //   wasmMtimeMax: 1575056171954.206,
      //   wasmFiles: [
      //     { filename: '/home/robin/example/src/foo.c', st: [Stats] },
      //     ...
      //   ],
      //   jsMtimeMax: 1575150698392.116,
      //   jsFiles: [
      //     { filename: '/home/robin/example/src/bar.js', st: [Stats] },
      //     ...
      //   ]
      // }

      // collect all unique source directories
      let dirs = new Map()  // dir => ("js"|"wasm")[]
      for (let f of sourceInfo.wasmFiles) {
        let dir = Path.dirname(f.filename)
        dirs.set(dir, (dirs.get(dir) || 0) | T_WASM)
      }
      for (let f of sourceInfo.jsFiles) {
        let dir = Path.dirname(f.filename)
        dirs.set(dir, (dirs.get(dir) || 0) | T_JS)
      }

      // add to dirmap
      for (let [dir, typeflags] of dirs) {
        let v = dirmap.get(dir)
        let ent = { m, typeflags }
        if (v) {
          v.push(ent)
        } else {
          dirmap.set(dir, [ent])
        }
      }

    }
    return dirmap
  }

}


async function packagemod(c, m, didBuild, jsSourcesChanged) {
  assert(m.emccfile.endsWith(".js"))
  let emccfile = Path.resolve(c.config.builddir, m.emccfile)
  let emccwasmfile = Path.resolve(c.config.builddir, m.wasmfile)
  let outfilejs = Path.resolve(c.config.projectdir, m.out)
  let outfilewasm = stripext(outfilejs) + ".wasm"
  let apihashfile = emccfile + ".apihash"

  if (didBuild && !jsSourcesChanged) {
    // The wasm module was built, but our JS source files didn't change.
    // See if we can avoid packaging JS.
    let wasmBufOut = {}
    let apiHashDiff = await compareWasmAPIHash(apihashfile, emccwasmfile, wasmBufOut)
    if (apiHashDiff == 0) {
      // API has not changed -- no need to recreate js package
      if (m.embed) {
        // patch WASM_DATA
        let WASM_DATA_js = gen_WASM_DATA(wasmBufOut.wasmbuf, m.target)
        let js = await fs.promises.readFile(outfilejs, "utf8")
        js = js.replace(/const WASM_DATA = ([^;]+);/, 'const WASM_DATA = ' + WASM_DATA_js)
        await writefile(outfilejs, js, "utf8")
      } else {
        // copy file
        await copyfile(c, emccwasmfile, outfilewasm)
      }
      return true
    }
  }

  let packageOptions = {
    projectdir:  c.config.projectdir,
    emccfile:    Path.resolve(c.config.builddir, m.emccfile), // path to JS file generated by emcc
    jsentryfile: m.jsentry,  // path to wrapper input JS entry file
    outfile:     outfilejs,  // path of output file
    wasmfile:    m.embed ? null : Path.relative(Path.dirname(outfilejs), outfilewasm),
    embed:       m.embed,
    modname:     m.name.startsWith("wasm_mod_") ? null : m.name, // 1st: auto from outfilejs
    target:      m.target,
    ecma:        m.ecma,
    debug:       c.debug,
    syncinit:    m.syncinit || m.embed,
    globalDefs:  m.constants,
  }

  // packageModule
  let { code, sourcemap } = await packageModule(c, packageOptions)
  let promises = []

  // copy wasm file
  if (!m.embed && emccwasmfile != outfilewasm && (didBuild || !fs.existsSync(outfilewasm))) {
    promises.push(
      copyfile(c, emccwasmfile, outfilewasm) )
  }

  // generate and write apihash file
  promises.push(
    writeWasmAPIHashFile(apihashfile, emccwasmfile) )

  // write js product soucemap file
  if (sourcemap) {
    promises.push(
      writefile(outfilejs + ".map", sourcemap, 'utf8') )
  }

  // write js product file
  promises.push(
    writefile(outfilejs, code, 'utf8') )

  return Promise.all(promises).then(() => true)
}


function compareWasmAPIHash(apihashfile, emccwasmfile, wasmBufOut) {  // Promise<identical:bool>
  return new Promise(async (resolve, reject) => {
    // load existing api hash from file
    let existingApiHashP = fs.promises.readFile(apihashfile).catch(err => {
      if (err.code == "ENOENT") {
        resolve(1)
      } else {
        reject(err)
      }
    })
    let wasmbuf = await fs.promises.readFile(emccwasmfile)
    wasmBufOut.wasmbuf = wasmbuf
    let apiHash = hashWasmAPI(wasmbuf)
    let existingApiHash = await existingApiHashP
    // dlog({
    //   apiHash: apiHash.toString("hex"),
    //   existingApiHash: existingApiHash ? existingApiHash.toString("hex") : null,
    // })
    resolve(existingApiHash ? apiHash.compare(existingApiHash) : 1)
  })
}


function writeWasmAPIHashFile(apihashfile, emccwasmfile) {  // Promise<identical:bool>
  return fs.promises.readFile(emccwasmfile)
    .then(hashWasmAPI)
    .then(apiHash => writefile(apihashfile, apiHash))
}


function copyfile(c, srcfile, dstfile) {
  c.log("copy %s -> %s",
    Path.relative(c.config.projectdir, srcfile),
    Path.relative(c.config.projectdir, dstfile)
  )
  return fs.promises.copyFile(srcfile, dstfile, fs.constants.COPYFILE_FICLONE)
}


function modsToBuild(c, allmodules) {
  if (c.force) {
    for (let m of allmodules) {
      let { sourcesP } = checkModSource(c, m)
      m[kSourceInfoPromise] = sourcesP
    }
    let p = Promise.resolve(allmodules)
    return { dirtyWasmModsP: p, dirtyJsModsP: p }
  }

  let dirtyWasmMods = []
  let dirtyWasmModsP = null
  let dirtyWasmModsCount = allmodules.length

  let dirtyJsMods = []
  let dirtyJsModsP = null
  let dirtyJsModsCount = allmodules.length

  dirtyWasmModsP = new Promise((dirtyWasmMods_resolve, dirtyWasmMods_reject) => {
  dirtyJsModsP   = new Promise((dirtyJsMods_resolve,   dirtyJsMods_reject) => {

    let onerr = err => {
      dirtyWasmMods_reject(err)
      dirtyJsMods_reject(err)
    }

    for (let m of allmodules) {
      let { wasmUpToDateP, jsUpToDateP, sourcesP } = checkModSource(c, m)
      m[kSourceInfoPromise] = sourcesP  // keep on truckin' w/ source scanning

      wasmUpToDateP.then(upToDate => {
        if (!upToDate) {
          dirtyWasmMods.push(m)
        }
        if (--dirtyWasmModsCount == 0) {
          dirtyWasmMods_resolve(dirtyWasmMods)
        }
      }).catch(onerr)

      jsUpToDateP.then(upToDate => {
        if (!upToDate) {
          dirtyJsMods.push(m)
        }
        if (--dirtyJsModsCount == 0) {
          dirtyJsMods_resolve(dirtyJsMods)
        }
      }).catch(onerr)
    }

  })  // Promise
  })  // Promise

  return { dirtyWasmModsP, dirtyJsModsP }
}


function checkModSource(c, m) {
  let r = {  // return value
    wasmUpToDateP: null,
    jsUpToDateP: null,
    sourcesP: null,
  }
  r.sourcesP      = new Promise((sources_resolve, sources_reject) => {
  r.wasmUpToDateP = new Promise((wasmUpToDate_resolve, wasmUpToDate_reject) => {
  r.jsUpToDateP   = new Promise((jsUpToDate_resolve, jsUpToDate_reject) => {

    // find oldest mtime of products (.js and .wasm product files)

    let jsProductMTime = mtimeSync(m.outfilejs)
    if (jsProductMTime <= 0) {  // product missing
      jsUpToDate_resolve(false)
      jsUpToDate_resolve = noop
    }

    let wasmProductMTime = jsProductMTime
    if (!m.embed) {
      wasmProductMTime = mtimeSync(m.outfilewasm)
      if (wasmProductMTime <= 0) {  // product missing
        wasmUpToDate_resolve(false)
        wasmUpToDate_resolve = noop
      }
    }

    // scan sources
    let wasmFiles = []
    let jsFiles = []
    let wasmSourceMtime = 0  // newest source file mtime used to make wasm module
    let jsSourceMtime = 0    // newest source file mtime used to make js package
    const onSourceFile = (file, st, type, parentfile) => {
      ;(type == "js" ? jsFiles : wasmFiles).push({ filename: file, st })

      if (type == "wasm") {
        wasmSourceMtime = Math.max(wasmSourceMtime, st.mtimeMs)
        if (st.mtimeMs > wasmProductMTime) {
          wasmUpToDate_resolve(false)
          wasmUpToDate_resolve = noop
          // throw "STOP"
        }
      } else {
        jsSourceMtime = Math.max(jsSourceMtime, st.mtimeMs)
        if (st.mtimeMs > jsProductMTime) {
          jsUpToDate_resolve(false)
          jsUpToDate_resolve = noop
        }
      }
    }

    scanmod(c, m, onSourceFile).then(() => {
      wasmUpToDate_resolve(true)
      jsUpToDate_resolve(true)
      sources_resolve({
        wasmMtimeMax: wasmSourceMtime,
        wasmFiles,
        jsMtimeMax: jsSourceMtime,
        jsFiles,
      })
    }).catch(err => {
      sources_reject(err)
      wasmUpToDate_reject(err)
      jsUpToDate_reject(err)
    })

  }) // Promise
  }) // Promise
  }) // Promise
  return r
}


function getNinjaBot(c, projectdir) {
  let n = ninjaBotInstances.get(projectdir)
  if (!n) {
    n = new NinjaBot(projectdir)
    n.start(c.quiet)
    ninjaBotInstances.set(projectdir, n)
  }
  return n
}


function mtimeSync(path) {
  let st = statSync(path)
  return st ? st.mtimeMs : 0
}


function noop(){}



// function getProductMTime(m) {
//   let st = statSync(m.outfilejs)
//   if (!st) {
//     return 0
//   }
//   let mtime = st.mtimeMs
//   if (!m.embed) {
//     if (st = statSync(m.outfilewasm)) {
//       mtime = Math.min(mtime, st.mtimeMs)
//     } else {
//       mtime = 0
//     }
//   }
//   return mtime
// }




// function collectSourceFiles(c, config) {
//   let srcfiles = []
//   for (let lib of config.clibs) {
//     srcfiles = srcfiles.concat(lib.getSourceFiles())
//   }
//   for (let m of config.modules) {
//     if (!m.jsentry) {
//       // TODO: use a generic one
//       continue
//     }
//     // TODO: find imports in JS files
//     srcfiles.push(Path.resolve(config.projectdir, m.jsentry))
//     if (m.jslib) {
//       srcfiles.push(Path.resolve(config.projectdir, m.jslib))
//     }
//   }
//   return srcfiles
// }
