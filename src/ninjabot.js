import { assert, dlog, statSync, tmpdir } from "./util"
import ninjabotProgramCode from "./ninjabot-program"

const net = require("net")
const fs = require("fs")
const Path = require("path")
const child_process = require("child_process")

const emsdkDockerImage = "rsms/emsdk:1.39.4"
const wasmcdir = __dirname;


// NinjaBot spawns a docker instance running rsms/emsdk:latest with misc/ninjabot.js
// which communicates with this process with JSON over stdio.
// The "remote" misc/ninjabot.js script manages ninja processes as requests arrive.
// This way we ware able to perform many calls to ninja without having to wait
// for docker to start every time.
// Importantly, this causes a big speed improvement for "watch" mode.
//
// To run the docker image interactively for development:
//
//   docker run --rm -it -v "$PWD:/src" rsms/emsdk:latest
//
export class NinjaBot {
  constructor(projectdir, builddir) {
    this.projectdir = Path.resolve(projectdir)
    this.builddir = Path.resolve(builddir)
    this.started = false
    this.dockerProc = null
    this.respawnTimer = null
    this.sendq = []
    this.nextRequestId = 0
    this.requestsInFlight = new Map()  // keyed by rid

    // convert builddir to be relative to projectdir since ninja is running in projectdir
    this.relbuilddir = Path.relative(this.projectdir, this.builddir)
    if (this.relbuilddir.startsWith("../")) {
      throw new Error(`builddir ${builddir} is outside projectdir ${this.projectdir}`)
    }
  }


  build(targets, clean) { // Promise<didWork:bool>
    return this.request("build", { dir: this.relbuilddir, targets, clean }).then(r => r.result)
  }


  clean() { // Promise<void>
    return this.request("clean", { dir: this.relbuilddir })
  }


  start(quiet) {
    if (!this.started) {
      this.started = true
      this.dockerSpawn(quiet)
    }
  }


  // request(type: string, msg :any) :Promise<any>
  request(requestType, msg) {
    let id = this.nextRequestId++
    let req = new Promise((resolve, reject) => {
      this.requestsInFlight.set(id, { resolve, reject })
      this.send({
        request: requestType,
        rid: id,
        ...msg,
      })
    })
    req.id = id
    return req
  }


  onmsg(msg) {
    // dlog("onmsg from docker:", msg)
    let r = this.requestsInFlight.get(msg.response)
    if (r) {
      this.requestsInFlight.delete(msg.response)
      if (msg.error) {
        let err = msg.error
        if (typeof err == "object" && err.message) {
          err.toString = () => err.message
        }
        r.reject(err)
      } else {
        r.resolve(msg)
      }
    }
  }


  send(msg) {
    let s = JSON.stringify(msg) + '\n'
    if (this.dockerProc) {
      this.dockerProc.stdin.write(s, "utf8")
    } else {
      this.sendq.push(s)
    }
  }


  dockerSpawn(quiet) {
    clearTimeout(this.respawnTimer)

    // make sure ninjabot program is available
    const ninjabotProgramName = "_wasmc-ninjabot.js"
    let ninjabotProgram = Path.join(this.builddir, ninjabotProgramName)
    let st = statSync(ninjabotProgram)
    if (!st || (DEBUG && statSync(__filename).mtimeMs > st.mtimeMs)) {
      fs.writeFileSync(ninjabotProgram, ninjabotProgramCode, "utf8")
    }

    let args = [
      "run",
      "--rm",

      // "-a=stdin", "-a=stdout", "-a=stderr", // attach to stdin, stdout and stderr
      // "-t",

      "-a", "stdin", "-a", "stdout", "-a", "stderr", "-i",

      "-v", this.projectdir + ":/src",
      // "-v", Path.dirname() + ":/wasmc-tmp:ro",

      emsdkDockerImage,
      "node", this.relbuilddir + "/" + ninjabotProgramName,
    ]

    // dlog("docker", args.join(" "))

    let p = this.dockerProc = child_process.spawn("docker", args, {
      cwd: wasmcdir,
      stdio: "pipe",
      shell: false,
    })

    // messages from ninjabot are delivered as JSON on stdout
    readJsonStream(p.stdout, this.onmsg.bind(this), onreaderr)

    // log messages from ninjabot arrive on stderr
    readLineStream(p.stderr, onlog)

    function onreaderr(err) {
      console.error("ninjabot read error:", String(err))
      p.kill()
      p.stdin.end()
      this.dockerProc = null
    }

    function onlog(line) {
      // dlog("LINE", {line})

      if (line == "ninja: no work to do.") {
        // silence this common message, except for in DEBUG builds
        dlog(line)
      } else if (
        !(
          line.startsWith("shared:ERROR: '/emsdk/upstream/bin/clang") ||
          line.startsWith("ninja: build stopped:") ||
          line.startsWith("Cleaning...") ||
          line.startsWith("no output file specified, not emitting output") ||  // emcc bug
          (quiet && (
            line.startsWith("[") ||
            line.startsWith("emcc -")
          ))
        )
      ) {
        // if (!line.startsWith("ninja:")) {
        //   line = "ninja: " + line
        // }
        process.stdout.write(line + "\n")
      }
    }

    p.on('exit', code => {
      console.log(`docker process exited with code ${code} -- respawning...`)
      this.dockerProc = null
      if (code != 0) {
        // TODO exponential back-off
        this.respawnTimer = setTimeout(() => { this.dockerSpawn(quiet) }, 1000)
      }
    })

    // flush sendq
    for (let s of this.sendq) {
      p.stdin.write(s, "utf8")
    }
    this.sendq = []
  }

} // class


function readJsonStream(r, onmsg, onerr) {
  readLineStream(r, line => {
    let msg ; try {
      msg = JSON.parse(line)
    } catch (_) {
      return onerr(`invalid data`, {line})
    }
    onmsg(msg)
  })
}


function readLineStream(r, online) {
  let prefixChunks = []  // Buffer[]

  r.on('end', () => {
    // free memory
    prefixChunks = []
  })

  r.on("data", chunk => {
    let i = chunk.indexOf(0xA)
    if (i == -1) {
      prefixChunks.push(chunk)
      return
    }
    let start = 0
    let end = i
    while (end > -1) {
      let b = chunk.subarray(start, end)
      if (prefixChunks.length > 0) {
        prefixChunks.push(b)
        b = Buffer.concat(prefixChunks)
        prefixChunks = []
      }
      online(b.toString("utf8"))

      start = end + 1
      end = chunk.indexOf(0xA, start)
    }
    if (end < chunk.length-1) {
      prefixChunks.push(chunk.subarray(start))
    }
  })
}

