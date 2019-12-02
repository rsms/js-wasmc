// type Formatter = (v :any, n? :number) => any
const inspect = require("util").inspect

const formatters = {
  s:   String,
  j:   JSON.stringify,
  j_:  (v, n) => JSON.stringify(v, null, n),
  r:   inspect,
  r_:  inspect,
  q:   v => JSON.stringify(String(v)),
  n:   Number,
  f:   Number,
  f_:  (v, n) => Number(v).toFixed(n),
  i:   Math.round,
  d:   Math.round,
  x:   v => Math.round(v).toString(16),
  X:   v => Math.round(v).toString(16).toUpperCase(),
}


// fmt formats a string
//
// Format specifiers:
//
//  %s       String(value)
//  %r       inspect(value)
//  %Nr      inspect(value, maxdepth=N)
//  %j       JSON.stringify(value)
//  %jN      JSON.stringify(value, null, N)
//  %q       JSON.stringify(String(value))
//  %n, %f   Number(value)
//  %fN      Number(value).toFixed(N)
//  %i, %d   Math.round(value)
//  %x       Math.round(value).toString(16)
//  %X       Math.round(value).toString(16).toUpperCase()
//  %%       "%"
//
// A value that is a function is called and its return value is used.
//
// fmt(format :string, ...args :any[]) :string
export function fmt(format, ...args) {
  let index = 0
  let s = String(format).replace(/%(?:([sjrqnfidxX%])|(\d+)([jrf]))/g, (s, ...m) => {
    let spec = m[0]
    if (spec == "%") {
      return "%"
    } else if (!spec) {
      // with leading number
      spec = m[2]
    }
    if (index == args.length) {
      throw new Error(`superfluous parameter %${spec} at offset ${m[3]}`)
    }
    let v = args[index++]
    if (typeof v == "function") {
      v = v()
    }
    return m[0] ? formatters[spec](v) : formatters[spec + "_"](v, parseInt(m[1]))
  })
  if (index < args.length) {
    // throw new Error(`superfluous arguments`)
    s += `(fmt:extra ${args.slice(index).map(v => `${typeof v}=${v}`).join(", ")})`
  }
  return s
}

