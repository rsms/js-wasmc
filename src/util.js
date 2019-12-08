const fs = require('fs')
const Path = require('path')
const os = require("os")
const inspect = require('util').inspect
import { glob } from "./glob"


// parseVersion takes a dot-separated version string with 1-4 version
// components and returns a 32-bit integer encoding the versions in a
// comparable format. E.g. "2.8.10.20" corresponds to 0x02080a14
//
// parseVersion(s :string) :int
export function parseVersion(s) {
  let v = s.split(".").map(Number)
  if (v.length > 4) {
    throw new Error(`too many version numbers in "${s}" (expected <=4)`)
  }
  while (v.length < 4) {
    v.unshift(0)
  }
  return v[0] << 24 | v[1] << 16 | v[2] << 8 | v[3]  // 8 bytes per component
}


export const NODE_VERSION = parseVersion(process.version.substr(1))
export const NODE_VERSION_10_12 = 0x000A0C00 // parseVersion("10.12.0")
export const NODE_VERSION_GTE_10_12 = NODE_VERSION >= NODE_VERSION_10_12
export const NODE_VERSION_11_7  = 0x000B0700 // parseVersion("11.7.0")
export const NODE_VERSION_GTE_11_7 = NODE_VERSION >= NODE_VERSION_11_7


let _tmpdir
export function tmpdir() {
  if (!_tmpdir) {
    _tmpdir = Path.join(os.tmpdir(), "wasmc-" + WASMC_VERSION)
    fs.mkdir(_tmpdir, ()=>{})
  }
  return _tmpdir
}


export function repr(v, depth) {
  return inspect(v, { colors: true, depth })
}


export const assert = DEBUG ? function(condition, message) {
  if (!condition) {
    let e = new Error(message || "assertion failed")
    e.name = "AssertionError"
    throw e
  }
} : function(){}


export const dlog = DEBUG ? function(){
  let e = new Error()
  let m = e.stack.split(/\n/, 3)[2].match(/(src\/[^\/]+\.js:\d+:\d+)/)
  let loc = m ? `D ${m[1]}:` : "D:"
  console.log.apply(console, [loc, ...arguments])
} : function(){}


// node 10.12.0 adds "recursive" option
export const mkdir = fs.promises.mkdir
export const mkdirs = path => mkdir(path, {recursive:true})
export const mkdirsSync = path => fs.mkdirSync(path, {recursive:true})


export function stat(path, options) {
  return fs.promises.stat(path, options).catch(e => {
    if (e.code == "ENOENT") {
      return null
    }
    throw e
  })
}


export function statSync(path) {
  try {
    return fs.statSync(path)
  } catch (err) {
    if (err.code == "ENOENT") {
      return null
    }
    throw err
  }
}


export async function writefile(path, data, options) {
  let triedMkdirs = false
  while (1) {
    try {
      // TODO: make this an atomic write (write to temp file + mv) since the implementation
      // of fs.promises.writeFile apparently opens and truncates the file, then waits a little,
      // at which point observers will see an empty file, and finally write to it.
      await fs.promises.writeFile(path, data, options)
      break
    } catch(e) {
      if (e.code == "ENOENT" && !triedMkdirs) {
        triedMkdirs = true
        await mkdirs(Path.dirname(path))
      } else {
        throw e
      }
    }
  }
}


export function writefileSync(path, data, options) {
  let triedMkdirs = false
  while (1) {
    try {
      fs.writeFileSync(path, data, options)
      break
    } catch(e) {
      if (e.code == "ENOENT" && !triedMkdirs) {
        triedMkdirs = true
        mkdirsSync(Path.dirname(path))
      } else {
        throw e
      }
    }
  }
}


// monotonic high-resolution time in milliseconds
//
export function monotime() {
  let v = process.hrtime()
  return (v[0] * 1000) + (v[1] / 1000000)
}


// fmtduration formats a millisecond length to human-readable text
//
export function fmtduration(ms) {
  return (
    ms < 0.001 ?    (ms * 1000000).toFixed(0) + "ns" :
    ms < 0.01  ?    (ms * 1000).toFixed(2) + "µs" :
    ms >= 1000*60 ? (ms / (1000*60)).toFixed(2) + "min" :
    ms >= 1000    ? (ms / 1000).toFixed(2) + "s" :
                     ms.toFixed(2) + "ms"
  )
}


// globv takes an array of filesnames which can contain glob patterns
// and expands the ones that do, returning a union of all expanded filenames.
//
export function globv(files) {
  let files2 = []
  for (let fn of files) {
    if (fn.indexOf("*") != -1) {
      files2 = files2.concat(glob(fn))
    } else {
      files2.push(fn)
    }
  }
  return files2
}


// stripext returns path without a filename extension
//
export function stripext(path) {
  let di = path.lastIndexOf(".")
  let si = path.lastIndexOf("/")
  return di > si ? path.substr(0, di) : path
}


// export async function readHeadStr(file, st) {
//   let f = await fs.promises.open(file, "r")
//   try {
//     if (!st) {
//       st = await f.stat()
//     }
//     let buf = Buffer.allocUnsafe(128)
//     let readsize = Math.min(buf.length, st.size)
//     let r = await f.read(buf, 0, readsize, null)
//     return buf.toString("utf8", 0, r.bytesRead)
//   } finally {
//     f.close()
//   }
// }
