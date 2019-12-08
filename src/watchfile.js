import { assert, dlog, stat } from "./util"

const fs = require("fs")
const Path = require("path")


// watchfile(filename :string, onchange :ChangeCallback) :FSWatcher
// type ChangeCallback = (event:"end")=>void
//                     | (event:string, st:fs.Stats)=>void
// interface FSWatcher {
//   close():void    // close the watcher. does NOT call onchange("end")
//   restart():void  // restart the watcher
// }
//
// Note: When onchange receives "end" event, the callback will never be called again,
// unless you call restart()
//
export function watchfile(filename, onchange) {
  filename = Path.resolve(filename)

  let lastMtime = fs.statSync(filename).mtimeMs
  let goneTimer = null
  let fswatcher = null

  async function onFSEvent(event, filename2) {
    let st = await stat(filename)

    // dlog("onFSEvent", {event, filename, filename2, st})

    if (event == "change") {
      if (st.mtimeMs > lastMtime) {
        lastMtime = st.mtimeMs
        onchange(event, st)
      }
      return
    }

    let restart = st => {
      assert(st)
      if (st.mtimeMs > lastMtime) {
        lastMtime = st.mtimeMs
        onchange(event, st)
      }
      watcher.restart()
    }

    if (!st) {
      goneTimer = setTimeout(async () => {
        let st = await stat(filename)
        if (st) {
          restart(st)
        } else {
          // considering file gone
          fswatcher.close()
          onchange("end")
        }
      }, 200)
    } else {
      clearTimeout(goneTimer)
      restart(st)
    }
  }

  var watcher = {
    restart() {
      if (fswatcher) {
        fswatcher.close()
      }
      fswatcher = fs.watch(filename, onFSEvent)
    },

    close() {
      if (fswatcher) {
        fswatcher.close()
        fswatcher = null
      }
    },
  }

  watcher.restart()

  return watcher
}
