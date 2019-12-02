import { assert, dlog, stat } from "./util"

const fs = require("fs")
const Path = require("path")


export async function resolveJSImports(entryfile, st) {
  let dir = Path.dirname(entryfile)

  console.time("read+scanImports")
  let imports = await readHead(entryfile, st)
  // let imports = scanImports(fs.readFileSync(entryfile), Path.dirname(entryfile))
  console.timeEnd("read+scanImports")

  dlog({ imports })
  // process.exit(0)

  return []
}


// resolveImportPath
function resolveImportPath(path) {
  //
}


// scanImports finds all imported paths in buf relative to dir
// Returns a list of strings of paths which are either absolute or symbolic.
//
function scanImports(buf, dir) {
  let importPaths = []
  const cbuf_import = Buffer.from("\nimport", "utf8")
  let i = 0
  while (1) {
    i = buf.indexOf(cbuf_import, i)
    if (i == -1) {
      break
    }
    i += 7  // past "\nimport"

    let bracelevel = 0
    let stringc = -1
    let stringstart = 0
    loop1: for (; i < buf.length; i++) {
      let c = buf[i]
      switch (c) {
        case 0x3B:  // ';'
          break loop1
        case 0x0A:  // LF
        case 0x09:  // TAB
        case 0x0D:  // CR
        case 0x20:  // SP
          // ignore whitespace
          break
        case 0x7B:  // '{'
          bracelevel++
          break
        case 0x7D:  // '}'
          bracelevel--
          break
        case 0x22:  // '"'
        case 0x27:  // '\''
        case 0x60:  // '`'
          if (stringc != -1) {
            if (c == stringc) {
              // dlog(`got string end`)
              if (bracelevel == 0) {
                let path = buf.toString("utf8", stringstart, i)
                // if (buf[stringstart] == 0x2F) {}  // '/'
                if (buf[stringstart] == 0x2E) {  // '.'
                  path = Path.resolve(dir, path)
                }
                importPaths.push(path)
                // dlog(`got path ${path}`)
                break loop1
              }
            } // else: just a character inside a string, e.g. "let's"
          } else {
            // dlog(`got string start`)
            stringc = c
            stringstart = i+1
          }
          break
        default:
          break
      }
    }
  }
  return importPaths
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
        // fs.close(fd, () => {})
        if (err) { return finalize(), reject(err) }
        // dlog(file + " bytesRead:", bytesRead)
        if (buf.length != bytesRead) {
          buf = buf.subarray(0, bytesRead)
        }
        try {
          resolve(scanImports(buf, Path.dirname(file)))
          // resolve(buf.toString("utf8"))
        } catch (err) {
          reject(err)
        } finally {
          finalize()
        }
      })
    })
  })
}


function mtime(fn) {
  return stat(fn).then(s => s ? s.mtimeMs : 0)
}


// function readHeadSync(file, st) {
//   dlog("open", file, st)
//   let fd = fs.openSync(file, "r")
//   let buf = readHeadBufs.pop() || Buffer.allocUnsafe(readHeadSize)
//   let readsize = Math.min(buf.length, st.size)
//   let bytesRead = fs.readSync(fd, buf, 0, readsize)
//   fs.close(fd, () => {})
//   dlog(file + " bytesRead:", bytesRead)
//   if (buf.length != bytesRead) {
//     buf = buf.subarray(0, bytesRead)
//   }
//   // TODO: if toString("utf8") fails, retry by progressively shaving off bytes at the end.
//   readHeadBufs.push(buf)
//   return buf.toString("utf8")
// }
