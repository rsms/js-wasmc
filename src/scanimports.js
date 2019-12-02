import { assert, dlog, repr } from "./util"

const Path = require("path")

const buf_import = Buffer.from("import", "ascii")
// const buf_from   = Buffer.from("from", "ascii")
// const buf_as     = Buffer.from("as", "ascii")
// const buf_any    = Buffer.from("any", "ascii")
const strEscapeMap = {
  'a': '\a',
  'b': '\b',
  'n': '\n',
  'r': '\r',
  't': '\t',
}


// scanImports finds all imported paths in buf relative to dir.
// Returns a list of strings of paths which are either absolute or symbolic.
//
export function scanImports(buf, dir) {
  let imports = []
  let importQueued = false

  jsscan(buf, (t, start, end, stringHasEscape) => {
    // dlog("token", t, repr(buf.toString("utf8", start, end)))
    if (t == "string") {
      if (!importQueued) {
        // dlog("stop scanner")
        return false
      }
      importQueued = false

      let path = buf.toString("utf8", start, end)
      if (stringHasEscape) {
        path = path.replace(/\\(.)/g, (_, s) => strEscapeMap[s] || s)
      }
      if (buf[start] == 0x2E) {  // '.'
        // relative import
        path = Path.resolve(dir, path)
      }
      imports.push(path)

    } else if (t == "id" && !importQueued) {
      if (buf[start] == 0x69 && buf.compare(buf_import, 0, buf_import.length, start, end) == 0) {
        importQueued = true
      } else {
        // dlog("stop scanner")
        return false
      }
    }
  })
  return imports
}


// very limited JavaScript syntax scanner that only really covers what is needed
// for import scanning
//
function jsscan(buf, ontok) {
  let i = 0
  let bracelevel = 0
  let stringc = -1
  let stringHasEscape = false
  let tokstart = -1
  let c2 = 0

  const MODE_BASE = 0
      , MODE_LINE_COMMENT = 1
      , MODE_BLOCK_COMMENT = 2
      , MODE_STRING = 3
  let mode = MODE_BASE

  for (; i < buf.length; i++) {
    let c = buf[i]

    //dlog(`mode ${mode}, c ${c.toString(16)} ${repr(String.fromCharCode(c))}`)

    if (mode == MODE_LINE_COMMENT) {
      if (c == 0x0A) { // LF
        mode = MODE_BASE
      }

    } else if (mode == MODE_BLOCK_COMMENT) {
      if (c == 0x2A && buf[i + 1] == 0x2F) {  // '*' '/'
        i++  // eat '/'
        mode = MODE_BASE
      }

    } else if (mode == MODE_STRING) {
      if (c == stringc) {
        if (buf[i - 1] == 0x5C) {  // '\\'
          stringHasEscape = true
        } else {
          if (bracelevel == 0) {
            // dlog("string END", repr(buf.toString("utf8", tokstart, i)))
            if (ontok("string", tokstart, i, stringHasEscape) === false) {
              return
            }
          }
          tokstart = -1
          mode = MODE_BASE
        }
      }

    } else {
      let tokended = tokstart != -1
      let braceend = false
      switch (c) {
      case 0x2F:  // '/'
        c2 = buf[i + 1]
        if (c2 == 0x2F) {
          i++
          mode = MODE_LINE_COMMENT
        } else if (c2 == 0x2A) {  // '*'
          i++
          mode = MODE_BLOCK_COMMENT
        }
        break

      case 0x3B:  // ';'
        break  // ignore

      case 0x09:  // TAB
      case 0x0A:  // LF
      case 0x0D:  // CR
      case 0x20:  // SP
        // ignore whitespace
        break

      case 0x7B:  // '{'
        bracelevel++
        break

      case 0x7D:  // '}'
        bracelevel--
        braceend = true
        break

      case 0x22:  // '"'
      case 0x27:  // '\''
      case 0x60:  // '`'
        // dlog("string START")
        tokstart = i + 1
        stringc = c
        stringHasEscape = false
        mode = MODE_STRING
        break

      default:
        // A-Z | a-z | _ | $
        if (tokstart == -1) {
          if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || c == 0x5F || c == 0x24) {
            // dlog("token START")
            tokstart = i
          } else {
            // ontok("op", i, i+1)  // e.g. '*'
          }
        }
        tokended = false
        break
      } // switch

      if (tokended) {
        if (bracelevel == 0 && !braceend) {
          // dlog("token END", repr(buf.toString("utf8", tokstart, i)))
          if (ontok("id", tokstart, i) === false) {
            return
          }
        }
        tokstart = -1
      }
    }

  } // for

  if (tokstart != -1 && bracelevel == 0) {
    if (mode == MODE_STRING) {
      // dlog("string END", repr(buf.toString("utf8", tokstart, i)))
      ontok("string", tokstart, i, stringHasEscape)
    } else {
      // dlog("token END", repr(buf.toString("utf8", tokstart, i)))
      ontok("id", tokstart, i)
    }
  }
}


if (DEBUG) { (()=>{
  dlog("test scanImports")
  function t(input, expectedImports) {
    input = input.replace(/^\n|\n[ \t]*$/g, "").replace(/\n[ \t]{4}/g, "\n")
    let imports = scanImports(Buffer.from(input, "utf8"), "/")
    // dlog({imports})
    let fail = false
    for (let i = 0; i < expectedImports.length; i++) {
      if (imports[i] !== expectedImports[i]) {
        console.error(`import #${i} is ${repr(imports[i])}; expected ${repr(expectedImports[i])}`)
        fail = true
      }
    }
    if (fail) {
      process.exit(1)
    }
    assert(imports.length === expectedImports.length, "import count mismatch", t)
  }

  t(`
    // line
    // line comment with comment import from "ohai"
    /* block comment with comment
      import from 'ohai'
    */
    import "./ali"
    import { "hello" as hello } from './meow/../bar'
    import
      * as any
      from "cat"
    import {a, b, c} from "./dud" // line c
    import {
      a,  // line c 1
      b,  // line c 2
      c,  // line c 3
    } from "./eli"
    import { a, /* block c 1 */ b, /* block c 2 */ } from "./fro" /* block c 3 */
    import a from "./meow \\"tse\\" toun\\tge"
    const foo = 3

  `,[
    "/ali",
    "/bar",
    "cat",
    "/dud",
    "/eli",
    "/fro",
    "/meow \"tse\" toun\tge",
  ])
})()}
