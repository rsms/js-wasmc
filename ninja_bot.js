const net = require("net")
const fs = require("fs")
const Path = require("path")
const child_process = require("child_process")

const log = console.error.bind(console)
const stdin = process.stdin
const noWorkToDoMsg = Buffer.from("ninja: no work to do", "utf8")

main()


function main() {
  // log("from inside docker image. cwd:", process.cwd())

  if (stdin.setRawMode) {
    stdin.setRawMode(true)
  }
  stdin.resume()

  // exit when stdin is closed
  stdin.on('end', function() {
    process.exit(0)
  })

  readJsonStream(stdin, onmsg, die)
}


function ninja_build(dir, targets, clean) {
  if (clean) {
    return ninja_clean(dir).then(() => ninja_exec(dir, targets))
  } else {
    return ninja_exec(dir, targets)
  }
}


function ninja_clean(dir) {
  return ninja_exec(dir, ["-t", "clean"])
}


function ninja_exec(dir, args) {
  // log("ninja_exec", {dir, args})
  return new Promise((resolve, reject) => {
    let p = child_process.spawn("ninja", args, {
      cwd: dir,
      stdio: [
        "ignore",  // stdin
        "pipe",    // stdout
        "inherit", // stderr
      ],
    })

    let didWork = true

    p.stdout.on("data", chunk => {
      if (chunk.indexOf(noWorkToDoMsg) != -1) {
        didWork = false
      }
      // log("ninja: STDOUT:", chunk)
      process.stderr.write(chunk)
    })

    p.on("error", err => {
      if (err.code == "ENOENT") {
        // this means the dir does exist
        err = { message:`${dir} is not a directory`, code: "ENOENT" }
      }
      reject(err)
      log("ninja: error:", err)
    })

    p.on("exit", code => {
      // log("ninja exited with code", code)
      if (code == 0) {
        resolve(didWork)
      } else {
        // let errmsg = stderr.replace(/\bninja: error:\s+/g, "").trim()
        reject("ninja error")
      }
    })
  })
}


function handleRequest(requestId, p) {
  // ninja -t clean
  p.then(result => {
    send({ response: requestId, result })
  }).catch(err => {
    send({ response: requestId, error: (err.message || String(err)) })
  })
}


function onmsg(msg) {
  // log("onmsg", msg)
  if (msg.request == "build") {
    handleRequest(msg.rid, ninja_build(msg.dir, msg.targets, msg.clean))
  } else if (msg.request == "clean") {
    handleRequest(msg.rid, ninja_clean(msg.dir))
  } else {
    send({ response: msg.rid, error: `invalid ninjabot command: ${msg.request}` })
  }
}


function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}


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


function die(err) {
  log(err)
  process.exit(1)
}
