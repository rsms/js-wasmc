const fs = require('fs')
const map = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
if (map.sourcesContent) {
  delete map.sourcesContent
  fs.writeFileSync(process.argv[2], JSON.stringify(map), 'utf8')
}
