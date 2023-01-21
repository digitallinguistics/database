import types from './types.js'

export default function validate(item) {

  if (!types.has(item.type)) {
    throw new Error(`Database items require a valid 'type' property.`)
  }

  const container = types.get(item.type)

  if (container === `data` && typeof item?.language?.id !== `string`) {
    throw new TypeError(`Items in the 'data' container require a 'language.id' property.`)
  }

}
