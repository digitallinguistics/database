/**
 * A class representing a database response.
 */
export default class DatabaseResponse {

  /**
   *
   * @param {Object}       options The `status` property is always required (but defaults to 200). Either `message` or `data` must also be present.
   * @param {Object|Array} [options.data]
   * @param {String}       [options.message]
   * @param {Integer}      [options.status=200]
   */
  constructor({ data, message, status = 200 }) {

    this.status = status

    if (data) this.data = data
    if (message) this.message = message

  }

}
