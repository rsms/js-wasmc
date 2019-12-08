import { fmt } from "./fmt"
import { stdoutStyle, stderrStyle } from "./termstyle"

const Path = require("path")

export class Context {
  constructor() {
    this.debug = false
    this.watch = false
    this.force = false
    this.config = {}  // set from configure
    this._quiet = false
  }

  log(format, ...args) {
    console.log(stdoutStyle.white(fmt(format, ...args)))
  }

  warn(format, ...args) {
    console.error(stderrStyle.orange(fmt(format, ...args)))
  }

  logImportant(format, ...args) {
    console.log(stdoutStyle.lightyellow(fmt(format, ...args)))
  }

  error(format, ...args) {
    console.error(stderrStyle.red(fmt(format, ...args)))
  }

  relpath(filename) {
    return Path.relative(this.config.projectdir, filename)
  }

  get quiet() { return this._quiet }
  set quiet(v) {
    if (this._quiet = v) {
      this.log = function(){}
      this.warn = function(){}
    } else {
      delete this.log
      delete this.warn
    }
  }
}
