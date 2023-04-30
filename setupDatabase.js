import { config } from 'dotenv'

config()

import Database from './Database.js'

const dbName   = process.env.COSMOS_DB_NAME
const endpoint = process.env.COSMOS_ENDPOINT
const key      = process.env.COSMOS_KEY
const db       = new Database({ dbName, endpoint, key })

await db.setup()
