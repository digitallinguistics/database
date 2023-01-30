import addFormats from 'ajv-formats'
import dbSchemas  from './schemas/index.js'
import dlxSchemas from '@digitallinguistics/schemas'
import isni       from 'isni-utils'
import Validator  from 'ajv'

const options = {
  allowUnionTypes: true,  // don't love this, but necessary for the CSL schemas
  strictSchema:    false, // allow unknown keywords
}

const validator = new Validator(options)

addFormats(validator, [`date`, `date-time`, `email`, `uri`, `uuid`])

validator.addFormat(`isni`, isni.validate)

// Add database-specific schemas.
// Note: This overrides DaFoDiL schemas with the same name.
for (const [type, schema] of Object.entries(dbSchemas)) {
  dlxSchemas[type] = schema
}

// Add all schemas to validator.
for (const schema of Object.values(dlxSchemas)) {
  validator.addSchema(schema)
}


export default validator
