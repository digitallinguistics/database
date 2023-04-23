import chunk            from './utilities/chunk.js'
import { CosmosClient } from '@azure/cosmos'
import DatabaseResponse from './DatabaseResponse.js'
import hasTranscription from './scripts/hasTranscription.js'
import validator        from './validator.js'

// NOTE: Cosmos DB Create methods modify the original object by setting an `id` property on it.

/**
 * A class for managing a Cosmos DB database connection.
 */
export default class Database {

  /**
   * Cosmos DB's limit on bulk operations.
   */
  bulkLimit = 100

  /**
   * The Cosmos DB client.
   */
  client

  /**
   * A Map of types > database types.
   */
  dbTypes = new Map(Object.entries({
    // Do not include BibliographicSource. It's an override rather than an extension.
    Bundle:   `DatabaseBundle`,
    Language: `DatabaseLanguage`,
    Lexeme:   `DatabaseLexeme`,
    // Do not include Project. It's a Digitalis-specific schema that doesn't need an extension.
    Text:     `DatabaseText`,
    // Do not include User. It's a Digitalis-specific schema that doesn't need an extension.
  }))

  /**
   * A Map of database types > containers.
   */
  types = new Map(Object.entries({
    BibliographicSource: `metadata`,
    Language:            `metadata`,
    Lexeme:              `data`,
    Person:              `metadata`,
    Project:             `metadata`,
    Text:                `data`,
    User:                `metadata`,
  }))

  /**
   * The JSON Schema validator, preloaded with the DaFoDiL schemas.
   */
  validator = validator

  /**
   * Create a new Database client.
   * @param {String} dbName The name to use for the database. Should generally be `digitallinguistics` for production and `test` otherwise.
   */
  constructor({
    dbName,
    endpoint,
    key,
  }) {
    this.dbName   = dbName
    this.client   = new CosmosClient({ endpoint, key })
    this.database = this.client.database(this.dbName)
    this.data     = this.database.container(`data`)
    this.metadata = this.database.container(`metadata`)
  }


  // DEV METHODS

  /**
   * Deletes all the items from all the containers in the database.
   * @returns {Promise}
   */
  async clear({ silent = true } = {}) {

    if (!silent) console.info(`Clearing the "${ this.dbName }" database.`)

    await Promise.all([
      this.clearContainer(`data`),
      this.clearContainer(`metadata`),
    ])

    if (!silent) console.info(`The "${ this.dbName }" database has been cleared.`)

  }

  /**
   * Deletes all the items from a single container.
   * @param {String} container The name of the container to clear items from.
   * @returns {Promise}
   */
  async clearContainer(container) {

    const { resources } = await this[container].items.readAll().fetchAll()

    const batches = chunk(resources, this.bulkLimit)

    for (const batch of batches) {

      const operations = batch.map(item => ({
        id:            item.id,
        operationType: `Delete`,
        partitionKey:  container === `data` ? item.language.id : item.type,
      }))

      await this[container].items.bulk(operations)

    }

  }

  /**
   * Delete the entire database.
   * @returns {Promise}
   */
  async delete() {

    if (this.dbName === `digitallinguistics`) {
      throw new Error(`This error is here to guard against accidental deletion. Comment it out or delete the database manually if you really truly actually srsly for realzies do want to delete the "digitallinguistics" database.`)
    }

    console.info(`Deleting the "${ this.dbName }" database.`)

    await this.database.delete()

    console.info(`Database "${ this.dbName }" successfully deleted.`)

  }

  /**
   * Add a single item to a container.
   * @param {String} container The name of the container to add the item to.
   * @param {Object} data      The data to add.
   * @returns {Promise<CosmosDBDatabaseResponse>}
   */
  seedOne(container, data = {}) {

    const { valid, errors } = this.validate(data)

    if (!valid) {
      console.error(data)
      console.error(errors)
      throw new TypeError(`ValidationError`, { cause: errors })
    }

    return this[container].items.create(data)

  }

  /**
   *
   * @param {String}  container The name of the container to seed the data to.
   * @param {Integer} count     The number of copies to add.
   * @param {Object}  [data={}] The data to add.
   * @returns {Promise<Array>}
  */
  async seedMany(container, count, data = {}) {

    const { valid, errors } = this.validate(data)

    if (!valid) {
      console.error(data)
      console.error(errors)
      throw new TypeError(`ValidationError`, { cause: errors })
    }

    const copy = Object.assign({}, data)

    delete copy.id

    const operations    = []
    const operationType = `Create`
    const partitionKey  = container === `data` ? copy.language?.id : copy.type

    for (let i = 0; i < count; i++) {
      operations[i] = {
        operationType,
        resourceBody: Object.assign({}, copy),
      }
    }

    const batches = chunk(operations, this.bulkLimit)
    const results = []

    for (const batch of batches) {
      // NB: In order for `.batch()` to work, add a partition key to each item (`language.id` or `type`),
      // and provide the *value* of the partition key as the 2nd argument to `batch()`.
      const response = await this[container].items.batch(batch, partitionKey)
      results.push(...response.result)
    }

    return results

  }

  /**
   * Creates the database, container, stored procedures, and user-defined functions in Cosmos DB if they don't yet exist.
   * @returns {Promise}
   */
  async setup() {

    console.info(`Setting up the "${ this.dbName }" database.`)

    const { database } = await this.client.databases.createIfNotExists({ id: this.dbName })

    // Containers

    const { container: data } = await database.containers.createIfNotExists({
      id:           `data`,
      partitionKey: `/language/id`,
    })

    await database.containers.createIfNotExists({
      id:           `metadata`,
      partitionKey: `/type`,
    })

    // Server-Side Scripts

    const hasTxnID     = `hasTxn`
    const hasTxnScript = data.scripts.userDefinedFunction(hasTxnID)

    try {

      await hasTxnScript.read()

    } catch (error) {

      await data.scripts.userDefinedFunctions.create({
        body: hasTranscription.toString(),
        id:   `hasTxn`,
      }, {
        enableScriptLogging: true,
      })

    }

    console.info(`Setup complete for the "${ this.dbName }" database.`)

  }


  // GENERIC METHODS

  /**
   * Add a single item to the database.
   * NOTE: `Create` operations do not require a partition key (it's determined automatically).
   * @param {String} container
   * @param {Object} data
   * @returns {Promise<DatabaseResponse>}
   */
  async addOne(container, data) {

    const { valid, errors } = this.validate(data)

    if (!valid) {
      return new DatabaseResponse({
        errors,
        message: `Validation Error: See 'errors' property for more information.`,
        status:  422,
      })
    }

    try {

      const { resource, statusCode } = await this[container].items.create(data)
      return new DatabaseResponse({ data: resource, status: statusCode })

    } catch (err) {

      const message = err.code === 409 ? `Item with ID ${ data.id } already exists.` : err.message
      return new DatabaseResponse({ message, status: err.code })

    }

  }

  /**
   * Add multiple items to the database.
   * NOTE: This is a batch operation. It will fail if any individual operations fail.
   * NOTE: All items must be part of the same partition (data = `language.id`, metadata = `type`).
   * @param {String} container
   * @param {String} partitionKey
   * @param {Array}  [items=[]]
   */
  async addMany(container, partitionKey, items = []) {

    if (items instanceof Map) {
      items = Array.from(items.values())
    }

    for (const item of items) {

      const { valid, errors } = this.validate(item)

      if (!valid) {
        return new DatabaseResponse({
          errors,
          message: `Validation Error: See 'errors' property for more information.`,
          status:  422,
        })
      }

    }

    const operationType = `Create`

    const operations = items.map(resourceBody => ({
      operationType,
      resourceBody,
    }))

    const batches = chunk(operations, this.bulkLimit)
    const results = []

    for (const batch of batches) {

      // NB: In order for `.batch()` to work, add a partition key to each item (`language.id` or `type`),
      // and provide the *value* of the partition key as the 2nd argument to `batch()`.
      const response = await this[container].items.batch(batch, partitionKey)

      if (response.code === 207) {
        return new DatabaseResponse({
          data:      response.result,
          status:    207,
          substatus: response.substatus,
        })
      }

      results.push(...response.result)

    }

    const data = results.map(({ resourceBody }) => resourceBody)

    return new DatabaseResponse({
      data,
      status: 201,
    })

  }

  /**
   * Count the number of items of the specified type. Use the `options` parameter to provide various filters.
   * The `language` option is optimized for the `data` container. It won't ever be run on the `metadata` container.
   * The `project` option is optimized for the `metadata` container but not the `data` container.
   * The `language` + `project` option is optimized for both containers.
   * @param {String} type               The type of item to count.
   * @param {Object} [options={}]       An options hash.
   * @param {String} [options.language] The ID of the language to filter for.
   * @param {String} [options.project]  The ID of the project to filter for.
   * @returns {Promise<DatabaseResponse>}
   */
  async count(type, options = {}) {

    const container             = this.types.get(type)
    const { language, project } = options

    if (language && typeof language !== `string`) {
      throw new Error(`The "language" option must be a string.`)
    }

    if (project && typeof project !== `string`) {
      throw new Error(`The "project" option must be a string.`)
    }

    let query = `SELECT COUNT(${ container }) FROM ${ container } WHERE ${ container }.type = '${ type }'`

    if (language) query += ` AND ${ container }.language.id = '${ language }'`

    if (project) {
      query += ` AND EXISTS(
        SELECT VALUE project
        FROM project IN ${ container }.projects
        WHERE project.id = '${ project }'
      )`
    }

    const { resources }   = await this[container].items.query(query).fetchAll()
    const [{ $1: count }] = resources

    return new DatabaseResponse({ data: { count } })

  }

  /**
   * Get a single item from the database.
   * @param {(`data`|`metadata`)} container The name of the container to get the item from.
   * @param {String}              partition The partition to read from.
   * @param {String}              id        The ID of the item to retrieve.
   * @returns {Promise<DatabaseResponse>}
   */
  async getOne(container, partition, id) {

    // NB: Best practice is that point reads always have a partition specified.
    // If you don't, your database model probably needs a redesign.
    const { resource, statusCode } = await this[container].item(id, partition).read()

    return new DatabaseResponse({ data: resource, status: statusCode })

  }

  /**
   * Get multiple items from the database by partition key and ID.
   * @param {String}        container
   * @param {String}        partitionKey
   * @param {Array<String>} ids
   * @returns {Promise<DatabaseResponse>}
   */
  async getMany(container, partitionKey, ids = []) {

    if (ids.length > this.bulkLimit) {
      return new DatabaseResponse({
        message: `You can only retrieve ${ this.bulkLimit } items at a time.`,
        status:  400,
      })
    }

    const operationType = `Read`
    const operations    = ids.map(id => ({ id, operationType, partitionKey }))
    const results       = await this[container].items.bulk(operations, { continueOnError: true })

    const data = results.map(({ resourceBody, statusCode }, i) => ({
      data:   resourceBody,
      id:     operations[i].id,
      status: statusCode,
    }))

    return new DatabaseResponse({
      data,
      status: 207,
    })

  }

  /**
   * Upsert a single item to the database.
   * @param {String} container
   * @param {Object} data
   * @returns {Promise<DatabaseResponse>}
   */
  async upsertOne(container, data) {

    const { valid, errors } = this.validate(data)

    if (!valid) {
      return new DatabaseResponse({
        errors,
        message: `Validation Error: See 'errors' property for more information.`,
        status:  422,
      })
    }

    const { resource, statusCode } = await this[container].items.upsert(data)

    return new DatabaseResponse({ data: resource, status: statusCode })

  }

  /**
   * Upsert multiple items to the database.
   * NOTE: This is a batch operation. It will fail if any individual operations fail.
   * NOTE: All items must be part of the same partition (data = `language.id`, metadata = `type`).
   * @param {String} container
   * @param {String} partitionKey
   * @param {Array}  [items=[]]
   */
  async upsertMany(container, partitionKey, items = []) {

    if (items instanceof Map) {
      items = Array.from(items.values())
    }

    for (const item of items) {

      const { valid, errors } = this.validate(item)

      if (!valid) {
        return new DatabaseResponse({
          errors,
          message: `Validation Error: See 'errors' property for more information.`,
          status:  422,
        })
      }

    }

    const operationType = `Upsert`

    const operations = items.map(resourceBody => ({
      operationType,
      resourceBody,
    }))

    const batches = chunk(operations, this.bulkLimit)
    const results = []

    for (const batch of batches) {

      // NB: In order for `.batch()` to work, add a partition key to each item (`language.id` or `type`),
      // and provide the *value* of the partition key as the 2nd argument to `batch()`.
      const response = await this[container].items.batch(batch, partitionKey)

      if (response.code === 207) {
        return new DatabaseResponse({
          data:      response.result,
          status:    207,
          substatus: response.substatus,
        })
      }

      results.push(...response.result)

    }

    const data = results.map(({ resourceBody }) => resourceBody)

    return new DatabaseResponse({
      data,
      status: 200,
    })

  }

  /**
   * Validate a single database object against the DaFoDiL schemas and the extended database schemas.
   * @param {Object} item A top-level database object to validate.
   */
  validate(item) {

    const container = this.types.get(item.type)
    let   valid     = false

    if (!container) {
      const e = new TypeError(`Database items require a valid 'type' property.`, { cause: item })
      return { errors: [e], valid }
    }

    if (container === `data` && typeof item?.language?.id !== `string`) {
      const e = new TypeError(`Items in the 'data' container require a 'language.id' property.`, { cause: item })
      return { errors: [e], valid }
    }

    // Make sure to use the extended Digitalis database schemas where appropriate.
    const schemaType = this.dbTypes.get(item.type) ?? item.type
    const schemaID   = `https://schemas.digitallinguistics.io/${ schemaType }.json`

    valid = this.validator.validate(schemaID, item)

    return {
      errors: validator.errors,
      valid,
    }

  }


  // TYPE-SPECIFIC METHODS

  /**
   * Retrieve a single Language from the database.
   * @param {String} id The ID of the language to retrieve.
   * @returns {Promise<DatabaseResponse>}
   */
  getLanguage(id) {
    return this.getOne(`metadata`, `Language`, id)
  }

  /**
   * Get multiple languages from the database.
   * @param {Object}  [options={}]           An options hash.
   * @param {String}  [options.permissions]  The ID of the user to return languages for. Returns only languages the user has explicit permissions to access.
   * @param {String}  [options.project]      The ID of a project to return languages for.
   * @param {Boolean} [options.public=false] Whether to return only languages that are part of a public project.
   * @param {String}  [options.user]         The ID of the user to return languages for. Returns all languages that the user can view.
   * @returns {Promise<DatabaseResponse>}
   */
  async getLanguages({
    permissions,
    project,
    public: publicOnly,
    user,
  } = {}) {

    let query = `SELECT * FROM metadata WHERE metadata.type = 'Language'`

    // NOTE: These EXISTS subqueries are checking for languages
    // whose *embedded* project has the specified properties.
    // They are *not* acting like a JOIN query.
    // Cosmos DB doesn't allow joins across items, only within an item.

    if (permissions) {
      query += ` AND (
        ARRAY_CONTAINS(metadata.permissions.admins, '${ permissions }')
        OR
        ARRAY_CONTAINS(metadata.permissions.editors, '${ permissions }')
        OR
        ARRAY_CONTAINS(metadata.permissions.viewers, '${ permissions }')
      )`
    }

    if (project) {
      query += ` AND EXISTS(
        SELECT VALUE project
        FROM project IN metadata.projects
        WHERE project.id = '${ project }'
      )`
    }

    if (publicOnly) {
      query += ` AND metadata.permissions.public = true`
    }

    if (user) {
      query += ` AND (
        metadata.permissions.public = true
        OR
        ARRAY_CONTAINS(metadata.permissions.admins, '${ user }')
        OR
        ARRAY_CONTAINS(metadata.permissions.editors, '${ user }')
        OR
        ARRAY_CONTAINS(metadata.permissions.viewers, '${ user }')
      )`
    }

    const queryIterator = this.metadata.items.query(query).getAsyncIterator()
    const data          = []

    for await (const result of queryIterator) {
      data.push(...result.resources)
    }

    return new DatabaseResponse({ data })

  }

  /**
   * Retrieve a single lexeme from the database.
   * @param {String} language The ID of the language the lexeme belongs to. Helps optimize the read operation if present.
   * @param {String} id       The ID of the lexeme to retrieve.
   * @returns {Promise<DatabaseResponse>}
   */
  getLexeme(language, id) {
    return this.getOne(`data`, language, id)
  }

  /**
   * Get multiple lexemes from the database.
   * @param {Object} [options={}]       An options hash.
   * @param {String} [options.language] The ID of a language to return lexemes for.
   * @param {String} [options.project]  The ID of a project to return lexemes for.
   * @returns {Promise<DatabaseResponse>}
   */
  async getLexemes(options = {}) {

    const { language, project } = options

    let query = `SELECT * FROM data WHERE data.type = 'Lexeme'`

    if (language) query += ` AND data.language.id = '${ language }'`

    if (project) {
      query += ` AND EXISTS(
        SELECT VALUE project
        FROM project IN data.projects
        WHERE project.id = '${ project }'
      )`
    }


    const queryIterator = this.data.items.query(query).getAsyncIterator()
    const data          = []

    for await (const result of queryIterator) {
      data.push(...result.resources)
    }

    return new DatabaseResponse({ data })

  }

  /**
   * Retrieve a single project from the database.
   * @param {String} id The ID of the project to retrieve.
   * @returns {Promise<DatabaseResponse>}
   */
  getProject(id) {
    return this.getOne(`metadata`, `Project`, id)
  }

  /**
   * Get multiple projects from the database.
   * @param {Object} [options={}]   An options hash.
   * @param {String} [options.user] The ID of a user to filter projects for.
   * @returns {Promise<DatabaseResponse>}
   */
  async getProjects(options = {}) {

    let query = `SELECT * FROM metadata WHERE metadata.type = 'Project'`

    if (`user` in options) {
      if (options.user) {

        query += ` AND (
          metadata.permissions.public = true
          OR
          ARRAY_CONTAINS(metadata.permissions.admins, '${ options.user }')
          OR
          ARRAY_CONTAINS(metadata.permissions.editors, '${ options.user }')
          OR
          ARRAY_CONTAINS(metadata.permissions.viewers, '${ options.user }')
        )`

      } else {

        query += ` AND metadata.permissions.public = true`

      }
    }

    const queryIterator = this.metadata.items.query(query).getAsyncIterator()
    const data          = []

    for await (const result of queryIterator) {
      data.push(...result.resources)
    }

    return new DatabaseResponse({ data })

  }

  /**
   * Retrieve a single bibliographic reference from the database.
   * @param {String} id The ID of the reference to retrieve.
   * @returns {Promise<DatabaseResponse>}
   */
  getReference(id) {
    return this.getOne(`metadata`, `BibliographicSource`, id)
  }

  /**
   * Get all the bibliographic references from the database.
   * @returns {Promise<DatabaseResponse>}
   */
  async getReferences() {

    const query = `SELECT * FROM metadata WHERE metadata.type = 'BibliographicSource'`

    const queryIterator = this.metadata.items.query(query).getAsyncIterator()
    const data          = []

    for await (const result of queryIterator) {
      data.push(...result.resources)
    }

    return new DatabaseResponse({ data })

  }

}
