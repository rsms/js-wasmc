import { assert, dlog, stat, statSync, repr } from "./util"
import { scanImports } from "./scanimports"

const fs = require("fs")
const Path = require("path")

let debugSrcDir = ""


// cb : (filename:string, st:fs.Stats, type:"js"|"wasm", parentFile?:string)=>void

export async function scanmod(c, m, cb) {
  const stat = fs.promises.stat
  let promises = []

  function statAndCallback(fn, type) {  // :Promise<fs.Stats>
    let p = stat(fn).then(st => (cb(fn, st, type), st))
    promises.push(p)
    return p
  }

  for (let depname of m.deps) {
    let lib = c.config.libmap[depname]
    let libsources = lib.getSourceFiles()
    libsources.forEach(fn => statAndCallback(fn, "wasm"))
  }

  if (m.jslib) {
    statAndCallback(Path.resolve(c.config.projectdir, m.jslib), "js")
  }

  if (m.jsentry) {
    let jsentryfile = Path.resolve(c.config.projectdir, m.jsentry)
    let resolved = new Set()
    promises.push(
      stat(jsentryfile).then(st => {
        cb(jsentryfile, st, "js")
        return resolveImports(jsentryfile, st, cb, resolved)
      })
    )
  }

  if (promises.length) {
    await Promise.all(promises).catch(err => {
      if (err !== "STOP") {
        throw err
      }
    })
  }
}


async function resolveImports(filename, st, cb, resolved) {
  let imports = await readHead(filename, st)
  // let imports = readHeadSync(filename, st)
  // let imports = scanImports(fs.readFileSync(filename), Path.dirname(filename))

  // skip symbolic imports e.g. `import "fs"`
  imports = imports.filter(path => {
    if (path[0] == "/" && !resolved.has(path)) {
      resolved.add(path)
      return true
    }
  })
  // dlog({ imports })

  return Promise.all(
    imports.map(path => {
      return resolveImport(filename, path, cb, resolved).then(r => {
        cb(r.filename, r.st, "js", filename)
        return resolveImports(r.filename, r.st, cb, resolved)
      })
    })
  )
}


async function resolveImport(parentFilename, path, cb, resolved) {
  // return require.resolve(path, {})

  let exts = ["", ".js", ".ejs"]
  for (let ext of exts) {
    let filename = path + ext
    let st = await stat(filename)
    if (st) {
      if (st.isFile()) {
        return { filename, st }
      } else if (ext == "" && st.isDirectory()) {
        filename = Path.join(path, "index")
      }
    }
  }

  throw new Error(`unable to resolve import ${JSON.stringify(path)} in ${parentFilename}`)
}



const readHeadSize = 2048
let readHeadBufs = []


function readHead(file, st) {
  return new Promise((resolve, reject) => {
    fs.open(file, "r", (err, fd) => {
      if (err) { return reject(err) }
      let buf = readHeadBufs.pop() || Buffer.allocUnsafe(readHeadSize)
      let finalize = () => {
        readHeadBufs.push(buf)
      }
      let readsize = Math.min(buf.length, st.size)
      fs.read(fd, buf, 0, readsize, null, (err, bytesRead) => {
        fs.close(fd, () => {})
        if (err) {
          readHeadBufs.push(buf)
          return reject(err)
        }
        try {
          let buf1 = bytesRead == buf.length ? buf : buf.subarray(0, bytesRead)
          resolve(scanImports(buf1, Path.dirname(file)))
        } catch (err) {
          reject(err)
        } finally {
          readHeadBufs.push(buf)
        }
      })
    })
  })
}


// function readHeadSync(file, st) {
//   let buf = readHeadBufs.pop() || Buffer.allocUnsafe(readHeadSize)
//   let fd = fs.openSync(file, "r", 0o666)
//   try {
//     let bytesRead = fs.readSync(fd, buf, 0, Math.min(st.size, buf.length))
//     let buf1 = bytesRead == buf.length ? buf : buf.subarray(0, bytesRead)
//     return scanImports(buf1, Path.dirname(file))
//   } finally {
//     fs.closeSync(fd)
//     readHeadBufs.push(buf)
//   }
// }


// function mtime(fn) {
//   return stat(fn).then(s => s ? s.mtimeMs : 0)
// }


/*export function scanmodSync(c, m, cb) {
  let promises = []

  function statAndCallback(fn, array) {
    cb(fn, fs.statSync(fn))
  }

  for (let depname of m.deps) {
    let lib = c.config.libmap[depname]
    let libsources = lib.getSourceFiles()
    for (let fn of libsources) {
      statAndCallback(fn)
    }
  }

  if (m.jslib) {
    statAndCallback(Path.resolve(c.config.projectdir, m.jslib))
  }

  if (m.jsentry) {
    let jsentryfile = Path.resolve(c.config.projectdir, m.jsentry)
    statAndCallback(jsentryfile)
    return scanImports(jsentryfile, st)
  }
}*/
