import { parseopts } from "./parseopts"
import { dlog, assert } from "./util"
import { configure } from "./configure"
import { build, buildIncrementally } from "./builder"

const Path = require("path")


export async function cmd_build(c, opts, args) {
  c.debug = opts.debug || opts.g
  c.watch = opts.watch || opts.w
  c.force = opts.clean
  c.quiet = opts.quiet || opts.q

  // configure
  dlog(">> configure")
  c.config = configure(c, opts.config, args[0], args.slice())
  if (c.config.didConfigure) {
    c.log(`wrote %s`, c.config.ninjafile)
  }

  // build
  try {
    if (c.watch) {
      dlog(">> buildIncrementally")
      await buildIncrementally(c)
    } else {
      dlog(">> build")
      let buildmods = await build(c)
      if (buildmods.length == 0) {
        c.log("No work to do")
      }
    }
  } catch (err) {
    if (err == "ninja error") {
      c.error("build failed")
    } else {
    c.error("build failed: %s", err.stack || err)
    }
    process.exit(1)
  }
}
