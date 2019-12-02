const fs = require('fs')
const Path = require('path')

const node_v10_12_0 = parseVersion("10.12.0")
const node_version  = parseVersion(process.version.substr(1))

export const mkdirs :(path :string)=>Promise<void> = (

  node_version >= node_v10_12_0 ? // node 10.12.0 adds "recursive" option
  (path :string) :Promise<void> => mkdir(path, {recursive:true}) :

  // legacy nodejs
  (path :string) :Promise<void> => {
    async function _mkdir(p :string) :Promise<void> {
      try {
        await mkdir(p)
      } catch (err) {
        if (err.code == 'ENOENT') {
          let p2 = Path.dir(p)
          if (p2 == p) { throw err }
          return await _mkdir(p2).then(() => _mkdir(p))
        } if (err.code == 'EEXIST') {
          try {
            if ((await stat(p)).isDirectory()) {
              return // okay, exists and is directory
            }
          } catch (_) {}
        }
        throw err
      }
    }
    return _mkdir(Path.resolve(path))
  }
)