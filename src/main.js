import { dlog, assert } from "./util"
import { parseopts } from "./parseopts"
import { Context } from "./context"
import * as cmd_package from "./cmd_package"
import { cmd_build } from "./cmd_build"
import { defaultEmsdkDockerImage } from "./ninjabot"

try{require('source-map-support').install()}catch(_){}

const fs = require('fs')
const Path = require('path')

const options = {
  // global options
  h: false, help: false,
  C: "",
  T: null,

  // build options
  debug: false, g: false,
  watch: false, w: false,
  config: "",
  image: "",
  clean: false,
  quiet: false, q: false,
}

const USAGE = `
wasmc ${WASMC_VERSION} WebAssembly builder.
usage: wasmc [options] [<dir>]
usage: wasmc [-C <dir>] -T<tool> [<tool-arg> ...]
options:
 -debug, -g              Disable optimizations and include data for debuggers.
 -watch, -w              Watch source files and rebuild as needed.
 -config <file>          Load config file from <file> instead of <dir>/wasmc.js
 -docker-image <string>  Docker image to build with instead of rsms/emsdk:1.39.4
 -clean                  Rebuild even when product and sources are up to date.
 -quiet, -q              Do not print information to stdout except for warnings and errors
 -help, -h               Show help message and exit
 -C <dir>                Change working directory; as if wasmc was invoked from <dir>.
 -T<tool>                Run <tool> instead of building. -T for list of tools. 

<dir>
  The module directory. Defaults to "." (dirname(<file>) with -config)
`

function usage() {
  console.error(USAGE.trim() + "\n")
  process.exit(1)
}


function die(msg) {
  console.error("wasmc: " + msg)
  console.error(`See wasmc -h for help.`)
  process.exit(1)
}


const tools = {
  "package": {
    descr: "Package emcc output into js",
    main: cmd_package.main,
  },
}


async function main() {
  let opts = {...options}
  let args = parseopts(process.argv.splice(2), opts, usage, { stopOnNonFlag: true })

  if (opts.h || opts.help) {
    usage()
  }

  let c = new Context()

  // chdir
  if (opts.C) {
    process.chdir(opts.C)
  }

  // tool?
  if (opts.T !== null) {
    if (opts.T == "") {
      console.log("available tools:")
      let names = Object.keys(tools)
      let longestName = names.reduce((len, s) => Math.max(len, s.length), 0)
      let spaces = "             "
      for (let name of names) {
        let tool = tools[name]
        console.log(
          "  wasmc -T" +
          name + spaces.substr(0, longestName - name.length) +
          "  " + tool.descr
        )
      }
      console.log("See `wasmc -T<tool> -h` for information about a tool.")
      process.exit(0)
    } else {
      let tool = tools[opts.T]
      if (!tool) {
        die(`no such tool "${opts.T}".\nSee wasmc -T for list of tools.`)
      }
      return tool.main(c, args)
    }
  }

  return cmd_build(c, opts, args)
}


main().then(() => {
  // must explicitly to cause ninjabot process to end
  process.exit(0)
}).catch(err => {
  console.error(err.stack||String(err))
  process.exit(1)
})
