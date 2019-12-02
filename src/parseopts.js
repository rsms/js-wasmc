// mutates opts
export function parseopts(argv, opts, usage, settings) {
  settings = {
    stopOnNonFlag: false,  // if true, stop processing on first non-flag argument
    ...(settings||{})
  }
  if (!opts) { opts = {} }
  const err = msg => {
    console.error(msg)
    usage()
    return args
  }
  let args = []
  let i = 0
  for (; i < argv.length; i++) {
    let arg = argv[i]
    if (arg[0] == '-') {
      if (arg[1] == '-') { break } // -- ends arguments

      if (opts.globalDefs !== undefined && arg.substr(0,2) == '-D') {
        let [k, v] = arg.substr(2).split('=')
        opts.globalDefs[k] = v ? (0,eval)('0||'+v) : true
        continue
      }

      if ("T" in opts && arg.substr(0,2) == '-T') {
        // -T<tool>
        opts.T = arg.substr(2)
        // ends argument parsing
        return args.concat(argv.slice(i+1))
      }

      let [k, v] = arg.replace(/^\-+/, '').split('=')
      if (!(k in opts)) {
        return err(`unknown option ${arg.split('=')[0]}`)
      }

      if (v === undefined) {
        let vtype = typeof opts[k]
        if (vtype == "boolean" || vtype == "undefined") {
          // e.g. -v  =>  opts.v = true
          v = true
        } else {
          // expect another arg that's the value
          v = argv[++i]
          if (v === undefined) {
            return err(`missing value for option ${arg}`)
          }
          if (vtype == "number") {
            let n = Number(v)
            if (isNaN(n)) {
              return err(`invalid numeric value ${v} for option ${arg}`)
            }
            v = n
          }
        }
      }

      opts[k] = v
    } else if (settings.stopOnNonFlag) {
      break
    } else {
      args.push(arg)
    }
  }

  if (i < argv.length) {
    // copy remainder of argv to args
    args = args.concat(argv.slice(i))
  }

  return args
}
