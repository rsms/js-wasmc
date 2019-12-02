import { assert, dlog } from "./util"

const crypto = require('crypto')


// Wasm 1.0 section IDs
const
  SECTION_TYPE     = 1,  // Function signature declarations
  SECTION_IMPORT   = 2,  // Import declarations
  SECTION_FUNCTION = 3,  // Function declarations
  SECTION_TABLE    = 4,  // Indirect function table and other tables
  SECTION_MEMORY   = 5,  // Memory attributes
  SECTION_GLOBAL   = 6,  // Global declarations
  SECTION_EXPORT   = 7,  // Exports
  SECTION_START    = 8,  // Start function declaration
  SECTION_ELEMENT  = 9,  // Elements section
  SECTION_CODE     = 10, //  Function bodies (code)
  SECTION_DATA     = 11; //  Data segments

// External kinds
const
  EXT_KIND_FUNCTION = 0, // indicating a Function import or definition
  EXT_KIND_TABLE    = 1, // indicating a Table import or definition
  EXT_KIND_MEMORY   = 2, // indicating a Memory import or definition
  EXT_KIND_GLOBAL   = 3; // indicating a Global import or definition

// value types
// -0x01 (i.e., the byte 0x7f) = i32
// -0x02 (i.e., the byte 0x7e) = i64
// -0x03 (i.e., the byte 0x7d) = f32
// -0x04 (i.e., the byte 0x7c) = f64
// -0x10 (i.e., the byte 0x70) = anyfunc
// -0x20 (i.e., the byte 0x60) = func
// -0x40 (i.e., the byte 0x40) = pseudo type for representing an empty block_type
const
  T_I32 = 0x7f,
  T_I64 = 0x7e,
  T_F32 = 0x7d,
  T_F64 = 0x7c,
  T_ANYFUNC = 0x70,
  T_FUNC = 0x60,
  T_EMPTY_BLOCK = 0x40;



export function hashWasmAPI(buf) {
  // extract interesting section slices
  const [typeSecBuf, importSecBuf, exportSecBuf] = scanSections(buf, [
    SECTION_TYPE,
    SECTION_IMPORT,
    SECTION_EXPORT,
  ])

  if (!typeSecBuf || !importSecBuf || !exportSecBuf) {
    return ""
  }

  const hash = crypto.createHash('sha256')
  hash.update(importSecBuf)
  hash.update(exportSecBuf)

  let funIndexes = []  // funIndex => true
  let globalIndexes = []  // globalIndex => true

  // filter types in type section that are used externally
  scanImportsFunTypes(importSecBuf, funIndexes)
  scanExportsFunTypes(exportSecBuf, funIndexes, globalIndexes)

  // hash function types which are used by imports
  let sc = new WasmScanner(typeSecBuf)
  let count = sc.readVarUInt32()
  for (let funIndex = 0; funIndex < count; funIndex++) {
    let start = sc.i
    sc.skipFuncType()
    if (funIndexes[funIndex]) {
      hash.update(typeSecBuf.subarray(start, sc.i))
    }
  }

  return hash.digest()
}


function scanExportsFunTypes(buf, funIndexes, globalIndexes) {
  let sc = new WasmScanner(buf)
  let count = sc.readVarUInt32()

  // dlog({ locationInFile: buf.byteOffset }, JSON.stringify(buf.toString("ascii")))
  //   \x17                              | count 23
  //   \x11__wasm_call_ctors\x00\x08     | name "__wasm_call_ctors" KIND_FUNCTION
  //   \x09bar_hello\x00\x09             | name "bar_hello"         KIND_FUNCTION
  //   \x09foo_hello\x00\x0A             | name "foo_hello"         KIND_FUNCTION
  //   \x08setThrew\x00\x1d\x06          | name "setThrew"          KIND_FUNCTION
  //   \x0e__cxa_demangle\x00\x3B        | name "__cxa_demangle"    KIND_FUNCTION
  //   \x06malloc\x00\x14\x06            | name "malloc"            KIND_FUNCTION
  //   \x04free\x00\x15\x06              | name "free"              KIND_FUNCTION
  //   \x0A__data_end\x03\x01            | name "__data_end"        KIND_GLOBAL
  //   \x09stackSave\x00\x1e\x06         | name "stackSave"         KIND_FUNCTION
  //   \x0AstackAlloc\x00\x1f\x06        | name "stackAlloc"        KIND_FUNCTION
  //   \x0CstackRestore\x00\x20\x06      | name "stackRestore"      KIND_FUNCTION
  //   \x10__growWasmMemory\x00\x21\x06  | name "__growWasmMemory"  KIND_FUNCTION
  //   \x0fdynCall_iidiiii\x00\x22\x06   | name "dynCall_iidiiii"   KIND_FUNCTION
  //   \x0bdynCall_vii\x00\x23\x06       | name "dynCall_vii"       KIND_FUNCTION
  //   \x0AdynCall_ii\x00\x24\x06        | name "dynCall_ii"        KIND_FUNCTION
  //   \x0CdynCall_iiii\x00\x25\x06      | name "dynCall_iiii"      KIND_FUNCTION
  //   \x0CdynCall_jiji\x00\x2D\x06      | name "dynCall_jiji"      KIND_FUNCTION
  //   \x09dynCall_v\x00\x27\x06         | name "dynCall_v"         KIND_FUNCTION
  //   \x0bdynCall_iii\x00\x28\x06       | name "dynCall_iii"       KIND_FUNCTION
  //   \x0AdynCall_vi\x00\x29\x06        | name "dynCall_vi"        KIND_FUNCTION
  //   \x0FdynCall_viiiiii\x00\x2A\x06   | name "dynCall_viiiiii"   KIND_FUNCTION
  //   \x0EdynCall_viiiii\x00\x2B\x06    | name "dynCall_viiiii"    KIND_FUNCTION
  //   \x0DdynCall_viiii\x00\x2C\x06     | name "dynCall_viiii"     KIND_FUNCTION

  for (let i = 0; i < count; ++i) {
    // dlog(sc.readUTF8Str())
    sc.skipSizePrefixedData()
    let external_kind = sc.buf[sc.i++]
    let index = sc.readVarUInt32()
    switch (external_kind) {
      case EXT_KIND_FUNCTION:
        funIndexes[index] = 1
        break
      case EXT_KIND_TABLE:
        dlog("TODO EXT_KIND_TABLE")
        break
      case EXT_KIND_MEMORY:
        dlog("TODO EXT_KIND_MEMORY")
        break
      case EXT_KIND_GLOBAL:
        globalIndexes[index] = 1
        break
    }
  }
}


function scanImportsFunTypes(buf, funIndexes) {
  let sc = new WasmScanner(buf)
  let count = sc.readVarUInt32()
  for (let i = 0; i < count; ++i) {
    // let modname  = sc.readUTF8Str()
    // let funcname = sc.readUTF8Str() ; dlog(`${modname} / ${funcname}`)
    sc.skipSizePrefixedData()
    sc.skipSizePrefixedData()
    switch (sc.buf[sc.i++] /* external_kind */) {
      case EXT_KIND_FUNCTION:
        funIndexes[sc.readVarUInt32()] = 1
        break
      case EXT_KIND_TABLE:
        sc.scanTableType()
        break
      case EXT_KIND_MEMORY:
        sc.scanResizableLimits()
        break
      case EXT_KIND_GLOBAL:
        sc.scanGlobalType()
        break
    }
  }
}


// sections should be an object with SECTION_* as keys for sections to scan.
// The `sections` object's properties are updated with
export function scanSections(buf, sectionIds) {
  let sectionsFound = 9
  let sectionBufs = new Array(sectionIds.length)
  let sc = new WasmScanner(buf)
  if (!sc.scanHeader()) {
    // buf is not a valid wasm module
    return ""
  }
  while (sc.i < buf.length) {
    let sid = sc.readVarInt7()
    let slen = sc.readVarUInt32()
    let sectionIdsIndex = sectionIds.indexOf(sid)
    if (sectionIdsIndex != -1) {
      sectionBufs[sectionIdsIndex] = buf.subarray(sc.i, sc.i + slen)
      if (sectionsFound == sectionIds.length) {
        break
      }
    }
    sc.i += slen  // skip past body of section
  }
  return sectionBufs
}


export class WasmScanner {
  constructor(buf) {
    this.buf = buf
    this.i = 0
  }


  // scans the magic bytes and the version. Returns true if
  scanHeader() {
    this.i = 8
    // magic is \0asm
    return this.buf.readUInt32LE(0) == 0x6d736100 && this.buf.readUInt32LE(4) == 1
  }


  scanResizableLimits() {
    let flags   = this.readVarInt1()
    let initial = this.readVarUInt32()
    let maximum = flags ? this.readVarUInt32() : -1
    return { flags, initial, maximum }
  }


  scanTableType() {
    let elemType = this.readVarInt7()
    let limits = this.scanResizableLimits()
    return { elemType, limits }
  }


  scanGlobalType() {
    let contentType = this.readValueType()
    let mutability = this.readVarInt1()
    return { contentType, mutability }
  }


  scanFuncType() {
    // form         varint7      the value for the func type constructor
    // param_count  varuint32    the number of parameters to the function
    // param_types  value_type*  the parameter types of the function
    // return_count varuint1     the number of results from the function
    // return_type  value_type?  the result type of the function (if return_count is 1)
    let form = this.readVarInt7()
    let nparams = this.readVarUInt32()
    let params = []
    for (let i = 0; i < nparams; i++) {
      params.push(this.readValueType())
    }
    let hasReturns = this.readVarInt1()
    let returns = hasReturns ? this.readValueType() : null
    return {form, params, returns}
  }


  skipFuncType() {
    this.i++ // form
    let nparams = this.readVarUInt32()
    this.i += nparams  // valueType is 1 byte
    if (this.readVarInt1()) {
      this.i += 1 // valueType is 1 byte
    }
  }


  skipSizePrefixedData() {
    let len = this.readVarUInt32()
    this.i += len
  }


  readValueType() {  // returns a T_* constant
    return this.buf[this.i++]
  }


  readUTF8Str() {
    let len = this.readVarUInt32()
    let i = this.i
    this.i += len
    let s = this.buf.toString("utf8", i, this.i)
    return s
  }


  readVarInt7() {
    let byte = this.buf[this.i++]
    return byte < 64 ? byte : -(128 - byte)
  }


  readVarInt1() {
    return this.buf[this.i++]
  }


  readVarUInt32() {
    let i = this.i
    let end = Math.min(i + 5, this.buf.length)
    let result = 0 // :uint32
    let shift = 0  // :int32
    let b = 0      // :byte
    while (i < end) {
      b = this.buf[i++]
      result = result | ((b & 0x7F) << shift)
      if ((b & 0x80) == 0) {
        break
      }
      shift += 7
    }

    let length = i - this.i
    this.i = i

    if (i == end && (b & 0x80)) {
      throw new Error("varint too large")
    } else if (length == 0) {
      throw new Error("varint of length 0")
    }

    return result
  }
}
