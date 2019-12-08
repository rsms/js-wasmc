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
    c.log(`Write %s`, c.config.ninjafile)
  }

  // build incrementally as source files change
  if (c.watch) {
    try {
      dlog(">> buildIncrementally")
      return buildIncrementally(c)  // never resolves; only rejects
    } catch (err) {
      c.error("%s", err.stack || err)
      process.exit(1)
    }
  }

  // build once
  try {
    dlog(">> build")
    let buildmods = await build(c)
    if (buildmods.length == 0) {
      c.log("No work to do")
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
