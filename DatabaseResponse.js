/**
 * A class representing a database response.
 */
export default class DatabaseResponse {

  /**
   * @param {Object} options The `status` property is always required (but defaults to 200). Either `message` or `data` must also be present.
   */
  constructor({ data, errors, message, status = 200, substatus }) {
    this.data      = data
    this.errors    = errors
    this.message   = message
    this.status    = status
    this.substatus = substatus
  }

}
