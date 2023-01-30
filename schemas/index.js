import { fileURLToPath } from 'node:url'
import path              from 'path'
import yamlParser        from 'js-yaml'

import {
  readdir as readDir,
  readFile,
} from 'node:fs/promises'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

let filenames = await readDir(__dirname)
filenames = filenames.filter(file => file.includes(`.yml`))

const schemas = {}

for (const filename of filenames) {
  const yaml   = await readFile(path.join(__dirname, filename), `utf8`)
  const schema = yamlParser.load(yaml)
  const type   = path.basename(filename, `.yml`)
  schemas[type] = schema
}

export default schemas
