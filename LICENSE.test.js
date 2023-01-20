import { expect }        from 'chai'
import { fileURLToPath } from 'url'
import path              from 'path'
import { readFile }      from 'fs/promises'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

describe(`LICENSE`, function() {

  it(`has the correct year`, async function() {

    const licensePath = path.join(__dirname, `LICENSE`)
    const text        = await readFile(licensePath, `utf8`)
    const currentYear = new Date().getFullYear()

    expect(text).to.include(currentYear)

  })

})
