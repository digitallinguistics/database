import * as dotenv from 'dotenv'

dotenv.config()

import Database       from './Database.js'
import { expect }     from 'chai'
import { randomUUID } from 'crypto'

import {
  BibliographicSource,
  Language,
  Lexeme,
  Permissions,
  Project,
  Text,
} from '@digitallinguistics/models'

const teardown = true

const admin    = `admin@digitallinguistics.io`
const badID    = `abc123`
const dbName   = `test`
const endpoint = process.env.COSMOS_ENDPOINT
const key      = process.env.COSMOS_KEY

const db = new Database({ dbName, endpoint, key })

// 3A Pattern:
// 1. Arrange
// 2. Act
// 3. Assert

describe(`Database`, function() {

  this.timeout(10000)

  before(function() {
    return db.setup()
  })

  afterEach(function() {
    if (teardown) return db.clear()
  })

  after(function() {
    if (teardown) return db.delete()
  })


  // GENERIC METHODS

  describe(`addOne`, function() {

    it(`201 Created`, async function() {

      const testVariable = randomUUID()

      const { data, status } = await db.addOne(`data`, new Lexeme({
        language: { id: randomUUID() },
        testVariable,
      }))

      expect(status).to.equal(201)
      expect(data.testVariable).to.equal(testVariable)

    })

    it(`409 Conflict`, async function() {

      const lexeme = new Lexeme({
        id:       randomUUID(),
        language: { id: randomUUID() },
      })

      await db.addOne(`data`, lexeme)

      const { data, message, status } = await db.addOne(`data`, lexeme)

      expect(data).to.be.undefined
      expect(message).to.equal(`Item with ID ${ lexeme.id } already exists.`)
      expect(status).to.equal(409)

    })

    it(`422 Unprocessable`, async function() {

      const lexeme = { id: randomUUID() }

      const { data, errors: [error], message, status } = await db.addOne(`data`, lexeme)

      expect(data).to.be.undefined
      expect(message).to.include(`Validation Error`)
      expect(error.message).to.include(`type`)
      expect(error.cause).to.equal(lexeme)
      expect(status).to.equal(422)

    })

  })

  describe(`addMany`, function() {

    it(`201 OK`, async function() {

      const language = { id: randomUUID() }

      const items = [
        new Lexeme({ language }),
        new Lexeme({ language }),
        new Lexeme({ language }),
      ]

      const { data, status } = await db.addMany(`data`, language.id, items)

      expect(status).to.equal(201)
      expect(data).to.have.length(3)

    })

    it(`207 Multi-Status`, async function() {

      const language = { id: randomUUID() }
      const id       = randomUUID()

      const items = [
        new Lexeme({ id, language }),
        new Lexeme({ id, language }),
      ]

      const { data, status } = await db.addMany(`data`, language.id, items)

      expect(status).to.equal(207)
      expect(data).to.be.an(`Array`)
      expect(data.some(result => result.statusCode === 409)).to.be.true

    })

    it(`422 Unprocessable`, async function() {

      const lexemeA = new Lexeme({ language: { id: randomUUID() } })
      const lexemeB = { id: randomUUID() }

      const { data, errors: [error], message, status } = await db.addMany(`data`, `Lexeme`, [lexemeA, lexemeB])

      expect(data).to.be.undefined
      expect(message).to.include(`Validation Error`)
      expect(error.message).to.include(`type`)
      expect(error.cause).to.equal(lexemeB)
      expect(status).to.equal(422)

    })

  })

  describe(`count`, function() {

    it(`200 OK`, async function() {

      const seedCount = 3

      await db.seedMany(`data`, seedCount, new Lexeme({
        language: {
          id: randomUUID(),
        },
      }))

      const { data: { count }, status } = await db.count(`Lexeme`)

      expect(status).to.equal(200)
      expect(count).to.equal(seedCount)

    })

    it(`option: language`, async function() {

      const seedCount = 3

      const languageA = randomUUID()
      const languageB = randomUUID()

      const lexemeA = new Lexeme({
        language: { id: languageA },
      })

      const lexemeB = new Lexeme({
        language: { id: languageB },
      })

      await db.seedMany(`data`, seedCount, lexemeA)
      await db.seedMany(`data`, seedCount, lexemeB)

      const { data: { count }, status } = await db.count(`Lexeme`, { language: languageA })

      expect(status).to.equal(200)
      expect(count).to.equal(seedCount)

    })

    it(`option: project (data container - cross-partition)`, async function() {

      const seedCount = 3

      const language = new Language({
        id: randomUUID(),
      })

      const project = new Project({
        id: randomUUID(),
      })

      const projectLexeme = new Lexeme({
        language: language.getReference(),
        projects: [project.getReference()],
      })

      const otherLexeme = new Lexeme({
        language: language.getReference(),
      })

      await db.seedMany(`data`, seedCount, projectLexeme)
      await db.seedMany(`data`, seedCount, otherLexeme)

      const { data: { count }, status } = await db.count(`Lexeme`, { project: project.id })

      expect(status).to.equal(200)
      expect(count).to.equal(seedCount)

    })

    it(`option: project (metadata container - single partition)`, async function() {

      const seedCount = 3
      const project   = randomUUID()

      const languageA = new Language({
        projects: [{ id: project }],
      })

      const languageB = new Language({
        projects: [{ id: randomUUID() }],
      })

      await db.seedMany(`metadata`, seedCount, languageA)
      await db.seedMany(`metadata`, seedCount, languageB)

      const { data: { count }, status } = await db.count(`Language`, { project })

      expect(status).to.equal(200)
      expect(count).to.equal(seedCount)

    })

    it(`options: language + project`, async function() {

      const seedCount = 3
      const projectA  = randomUUID()
      const projectB  = randomUUID()
      const languageA = randomUUID()
      const languageB = randomUUID()

      // add lexemes with language + project

      const lexemeA = new Lexeme({
        language: { id: languageA },
        projects: [{ id: projectA }],
      })

      await db.seedMany(`data`, seedCount, lexemeA)

      // add lexemes with language but different project

      const lexemeB = new Lexeme({
        language: { id: languageA },
        projects: [{ id: projectB }],
      })

      await db.seedMany(`data`, seedCount, lexemeB)

      // add lexemes with project but different language

      const lexemeC = new Lexeme({
        language: { id: languageB },
        projects: [{ id: projectA }],
      })

      await db.seedMany(`data`, seedCount, lexemeC)

      const { data: { count }, status } = await db.count(`Lexeme`, {
        language: languageA,
        project:  projectA,
      })

      expect(status).to.equal(200)
      expect(count).to.equal(seedCount)

    })

  })

  describe(`getOne`, function() {

    const container = `metadata`

    it(`200 OK`, async function() {

      const name                   = { eng: `Test` }
      const { resource: language } = await db.seedOne(container, new Language({ name }))
      const { data, status }       = await db.getOne(container, language.type, language.id)

      expect(status).to.equal(200)
      expect(data.name.eng).to.equal(language.name.eng)

    })

    it(`404 Not Found`, async function() {

      const { data, status } = await db.getOne(container, `Language`, badID)

      expect(status).to.equal(404)
      expect(data).to.be.undefined

    })

  })

  describe(`getMany`, function() {

    const container = `data`

    it(`200 OK`, async function() {

      const count            = 3
      const lexeme           = new Lexeme({ language: { id: randomUUID() } })
      const seedData         = await db.seedMany(container, count, lexeme)
      const ids              = seedData.map(({ resourceBody }) => resourceBody.id)
      const { data, status } = await db.getMany(container, lexeme.language.id, ids)

      expect(status).to.equal(207)
      expect(data).to.have.length(count)

      const [result] = data

      expect(result.status).to.equal(200)
      expect(result.data.id).to.equal(ids[0])

    })

    it(`400 Too Many IDs`, async function() {

      const ids                       = new Array(101).fill(badID, 0, 101)
      const { data, message, status } = await db.getMany(`data`, undefined, ids)

      expect(status).to.equal(400)
      expect(data).to.be.undefined
      expect(message).to.be.a(`string`)

    })

    it(`missing results`, async function() {

      const count      = 3
      const languageID = randomUUID()

      const lexeme = new Lexeme({
        language: {
          id: languageID,
        },
      })

      const seedData = await db.seedMany(`data`, count, lexeme)
      const ids      = seedData.map(({ resourceBody }) => resourceBody.id)

      ids.unshift(badID) // Use unshift here to test that Cosmos DB continues to return results after a 404.

      const { data, status } = await db.getMany(container, languageID, ids)

      expect(status).to.equal(207)
      expect(data).to.have.length(count + 1)

      const firstResult = data.shift()

      expect(firstResult.status).to.equal(404)
      expect(firstResult.data).to.be.undefined

      for (const item of data) {
        expect(item.status).to.equal(200)
        expect(ids).to.include(item.data.id)
      }

    })

  })

  describe(`upsertOne`, function() {

    it(`200 OK`, async function() {

      const oldVariable = randomUUID()
      const newVariable = randomUUID()

      const { resource: language } = await db.seedOne(`metadata`, new Language({ test: oldVariable }))

      language.test = newVariable

      const { data, status } = await db.upsertOne(`metadata`, language)

      expect(status).to.equal(200)
      expect(data.test).to.equal(newVariable)

    })

    it(`422 Unprocessable`, async function() {

      const { resource: language } = await db.seedOne(`metadata`, new Language)

      delete language.type

      const { data, errors: [error], message, status } = await db.upsertOne(`metadata`, language)

      expect(data).to.be.undefined
      expect(status).to.equal(422)
      expect(message).to.include(`Validation Error`)
      expect(error.message).to.include(`type`)
      expect(error.cause).to.equal(language)

    })

  })

  describe(`upsertMany`, function() {

    it(`200 OK`, async function() {

      const count    = 3
      const response = await db.seedMany(`metadata`, count, new Language)
      const items    = response.map(({ resourceBody }) => resourceBody)

      items.forEach((item, i) => { item.index = i })

      const { data, status } = await db.upsertMany(`metadata`, `Language`, items)

      expect(status).to.equal(200)
      expect(data).to.have.length(3)

      for (const item of items) {
        expect(item.index).to.be.within(0, 2)
      }

    })

    it(`422 Unprocessable`, async function() {

      const count    = 3
      const response = await db.seedMany(`metadata`, count, new Language)
      const items    = response.map(({ resourceBody }) => resourceBody)

      items.forEach((item, i) => { item.index = i })

      const testItem = items[1]

      delete testItem.type

      const { data, errors: [error], message, status } = await db.upsertMany(`metadata`, count, items)

      expect(status).to.equal(422)
      expect(data).to.be.undefined
      expect(message).to.include(`Validation Error`)
      expect(error.message).to.include(`type`)
      expect(error.cause).to.equal(testItem)

    })

  })

  describe(`validate`, function() {

    it(`bad type`, function() {

      const item = {}
      const { valid, errors: [error] } = db.validate(item)

      expect(valid).to.be.false
      expect(error.message).to.include(`type`)
      expect(error.cause).to.equal(item)

    })

    it(`missing partition key`, function() {

      const item = { type: `Lexeme` }
      const { valid, errors: [error] } = db.validate(item)

      expect(valid).to.be.false
      expect(error.message).to.include(`language.id`)
      expect(error.cause).to.equal(item)

    })

    it(`invalid (DaFoDiL schema)`, function() {

      const lexeme = new Lexeme({
        language: {
          id: randomUUID(),
        },
        lemma: true,
      })

      const { valid, errors: [error] } = db.validate(lexeme)

      expect(valid).to.be.false
      expect(error.instancePath).to.equal(`/lemma`)
      expect(error.message).to.equal(`must be object`)

    })

    it(`invalid (database schema)`, function() {

      const project = new Project()
      delete project.permissions

      const { valid, errors: [error] } = db.validate(project)

      expect(valid).to.be.false
      expect(error.params.missingProperty).to.equal(`permissions`)
      expect(error.message).to.include(`permissions`)

    })

    it(`valid`, function() {

      const language = { id: randomUUID() }
      const lexeme   = new Lexeme({ language })

      const { valid, errors } = db.validate(lexeme)

      expect(valid).to.be.true
      expect(errors).to.be.null

    })

  })


  // TYPE-SPECIFIC METHODS

  describe(`getLanguage`, function() {

    it(`200 OK`, async function() {

      const { resource: language } = await db.seedOne(`metadata`, new Language({ test: randomUUID() }))
      const { data, status }       = await db.getLanguage(language.id)

      expect(status).to.equal(200)
      expect(data.test).to.equal(language.test)

    })

    it(`404 Not Found`, async function() {

      const { data, status } = await db.getLanguage(badID)

      expect(status).to.equal(404)
      expect(data).to.be.undefined

    })

  })

  describe(`getLanguages`, function() {

    const container = `metadata`

    it(`200 OK`, async function() {

      const count = 3

      await db.seedMany(container, count, new Language)
      await db.seedMany(container, count, new Project)

      const { data, status } = await db.getLanguages()

      expect(status).to.equal(200)
      expect(data).to.have.length(count)

    })

    it(`many results`, async function() {

      const count = 200

      await db.seedMany(container, count, new Language)

      const { data, status } = await db.getLanguages()

      expect(status).to.equal(200)
      expect(data).to.have.length(count)

    })

    it(`option: permissions`, async function() {

      const count = 3

      const publicLanguage = new Language

      const userLanguage = new Language({
        permissions: new Permissions({
          admins: [admin],
          public: false,
        }),
      })

      await db.seedMany(container, count, publicLanguage.data)
      await db.seedMany(container, count, userLanguage.data)

      const { data, status } = await db.getLanguages({ permissions: admin })

      expect(status).to.equal(200)
      expect(data).to.have.length(count)

    })

    it(`option: project`, async function() {

      const count   = 3
      const project = { id: randomUUID() }

      const language = new Language({
        projects: [project],
      })

      await db.seedMany(container, count, language) // add languages with projects
      await db.seedMany(container, count, new Language) // add languages without projects

      const { data, status } = await db.getLanguages({ project: project.id })

      expect(status).to.equal(200)
      expect(data).to.have.length(count)
      expect(data.every(lang => lang.projects.find(proj => proj.id === project.id))).to.exist

    })

    it(`option: public`, async function() {

      const count = 3

      const publicLanguage = new Language({
        name: {
          eng: `Public Language`,
        },
      })

      const privateLanguage = new Language({
        name: {
          eng: `Private Language`,
        },
        permissions: new Permissions({
          public: false,
        }),
      })

      await db.seedMany(container, count, publicLanguage.data)
      await db.seedMany(container, count, privateLanguage.data)

      const { data, status } = await db.getLanguages({ public: true })

      expect(status).to.equal(200)
      expect(data).to.have.length(count)

    })

    it(`option: user`, async function() {

      const count          = 3
      const publicLanguage = new Language

      const privateLanguage = new Language({
        permissions: new Permissions({
          public: false,
        }),
      })

      const userLanguage = new Language({
        permissions: new Permissions({
          admins: [admin],
          public: false,
        }),
      })

      await db.seedMany(container, count, publicLanguage.data)
      await db.seedMany(container, count, privateLanguage.data)
      await db.seedMany(container, count, userLanguage.data)

      const { data, status } = await db.getLanguages({ user: admin })

      expect(status).to.equal(200)
      expect(data).to.have.length(count * 2)

    })

  })

  describe(`getLexeme`, function() {

    it(`200 OK`, async function() {

      const lexemeData = new Lexeme({
        language: {
          id: randomUUID(),
        },
        test: randomUUID(),
      })

      const { resource: lexeme } = await db.seedOne(`data`, lexemeData)
      const { data, status }     = await db.getLexeme(lexeme.language.id, lexeme.id)

      expect(status).to.equal(200)
      expect(data.test).to.equal(lexeme.test)

    })

    it(`404 Not Found`, async function() {

      const lexeme = new Lexeme({
        language: {
          id: randomUUID(),
        },
      })

      // Seeding the database with another lexeme from the same language
      // ensures that the partition being targeted exists.
      await db.seedOne(`data`, lexeme)

      const { data, status } = await db.getLexeme(lexeme.language.id, badID)

      expect(status).to.equal(404)
      expect(data).to.be.undefined

    })

  })

  describe(`getLexemes`, function() {

    const container = `data`

    it(`200 OK`, async function() {

      const count    = 3
      const language = { id: randomUUID() }

      await db.seedMany(container, count, new Lexeme({ language }))
      await db.seedMany(container, count, new Text({ language }))

      const { data, status } = await db.getLexemes()

      expect(status).to.equal(200)
      expect(data).to.have.length(count)

    })

    it(`many results`, async function() {

      const count = 200

      const lexeme = new Lexeme({
        language: {
          id: randomUUID(),
        },
      })

      await db.seedMany(`data`, count, lexeme)

      const { data, status } = await db.getLexemes()

      expect(status).to.equal(200)
      expect(data).to.have.length(count)

    })

    it(`option: language`, async function() {

      const count     = 3
      const languageA = randomUUID()
      const languageB = randomUUID()

      // add lexemes with language A

      const lexemeA = new Lexeme({
        language: {
          id: languageA,
        },
      })

      await db.seedMany(container, count, lexemeA)

      // add lexemes with language B

      const lexemeB = new Lexeme({
        language: {
          id: languageB,
        },
      })

      await db.seedMany(container, count, lexemeB)

      const { data, status } = await db.getLexemes({ language: languageA })

      expect(status).to.equal(200)
      expect(data).to.have.length(count)
      expect(data.every(lexeme => lexeme.language.id === languageA)).to.be.true

    })

    it(`option: project`, async function() {

      const count    = 3
      const projectA = randomUUID()
      const projectB = randomUUID()

      // add lexemes with project A

      const lexemeA = new Lexeme({
        language: { id: randomUUID() },
        projects: [{ id: projectA }],
      })

      await db.seedMany(container, count, lexemeA)

      // add lexemes with project B
      const lexemeB = new Lexeme({
        language: { id: randomUUID() },
        projects: [{ id: projectB }],
      })

      await db.seedMany(container, count, lexemeB)

      const { data, status } = await db.getLexemes({ project: projectA })

      expect(status).to.equal(200)
      expect(data).to.have.length(count)
      expect(data.every(lexeme => lexeme.projects.find(proj => proj.id === projectA))).to.exist

    })

    it(`option: language + project`, async function() {

      const count     = 3
      const languageA = randomUUID()
      const languageB = randomUUID()
      const projectA  = randomUUID()
      const projectB  = randomUUID()

      // language A + project A

      const lexemeA = new Lexeme({
        language: { id: languageA },
        projects: [{ id: projectA }],
      })

      await db.seedMany(container, count, lexemeA)

      // language A + project B

      const lexemeB = new Lexeme({
        language: { id: languageA },
        projects: [{ id: projectB }],
      })

      await db.seedMany(container, count, lexemeB)

      // language B + project A

      const lexemeC = new Lexeme({
        language: { id: languageB },
        projects: [{ id: projectA }],
      })

      await db.seedMany(container, count, lexemeC)

      const { data, status } = await db.getLexemes({
        language: languageA,
        project:  projectA,
      })

      expect(status).to.equal(200)
      expect(data).to.have.length(3)

    })

    it(`no results`, async function() {

      // This should return an empty array, not 404.
      // It's entirely possible to create a language but not have added lexemes for it yet.
      const { data, status } = await db.getLexemes({ language: badID })

      expect(status).to.equal(200)
      expect(data).to.have.length(0)

    })

  })

  describe(`getProject`, function() {

    it(`200 OK`, async function() {

      const { resource: project } = await db.seedOne(`metadata`, new Project({ test: randomUUID() }))

      const { data, status } = await db.getProject(project.id)

      expect(status).to.equal(200)
      expect(data.test).to.equal(project.test)

    })

    it(`404 Not Found`, async function() {

      const { data, status } = await db.getProject(badID)

      expect(status).to.equal(404)
      expect(data).to.be.undefined

    })

  })

  describe(`getProjects`, function() {

    const container = `metadata`

    it(`200 OK`, async function() {

      const count = 3

      await db.seedMany(container, count, new Project)
      await db.seedMany(container, count, new Language)

      const { data, status } = await db.getProjects()

      expect(status).to.equal(200)
      expect(data).to.have.length(count)

    })

    it(`many results`, async function() {

      const count = 200

      await db.seedMany(container, count, new Project)

      const { data, status } = await db.getProjects()

      expect(status).to.equal(200)
      expect(data).to.have.length(count)

    })

    // Do not test for `language` or `lexeme` options.
    // Projects don't contain info about their languages or lexemes.
    // The client should first request the lexeme/language,
    // then use `getMany()` to retrieve the associated projects by their IDs.

    it(`no results`, async function() {

      const { data, status } = await db.getProjects()

      expect(status).to.equal(200)
      expect(data).to.have.length(0)

    })

    it(`option: user`, async function() {

      const count = 3

      await db.seedMany(container, count, new Project({
        permissions: new Permissions({ admins: [admin] }),
      }))

      await db.seedMany(container, count, new Project({
        permissions: new Permissions({
          public: false,
        }),
      }))

      const { data, status } = await db.getProjects({ user: admin })

      expect(status).to.equal(200)
      expect(data).to.have.length(count)

    })

  })

  const bibData = {
    bibEntry: {
      text: `Hieber, Daniel W. 2023. Word classes.`,
    },
    csl: {
      id:   `Hieber2023`,
      type: `chapter`,
    },
  }

  describe(`getReference`, function() {

    const container = `metadata`

    it(`200 OK`, async function() {

      const { resource: reference }  = await db.seedOne(container, new BibliographicSource(bibData))
      const { data, errors, status } = await db.getReference(reference.id)

      expect(status).to.equal(200)
      expect(data.bibEntry.text).to.equal(bibData.bibEntry.text)
      expect(errors).to.be.undefined

    })

    it(`404 Not Found`, async function() {

      const { data, status } = await db.getReference(badID)

      expect(status).to.equal(404)
      expect(data).to.be.undefined

    })

  })

  describe(`getReferences`, function() {

    const container = `metadata`

    it(`200 OK`, async function() {

      const count = 3


      await db.seedMany(container, count, new BibliographicSource(bibData))

      const { data, status } = await db.getReferences()

      expect(status).to.equal(200)
      expect(data).to.have.length(count)

    })

    it(`many results`, async function() {

      const count = 200

      await db.seedMany(container, count, new BibliographicSource(bibData))

      const { data, status } = await db.getReferences()

      expect(status).to.equal(200)
      expect(data).to.have.length(count)

    })

    it(`no results`, async function() {

      const { data, status } = await db.getReferences()

      expect(status).to.equal(200)
      expect(data).to.have.length(0)

    })

  })

})
