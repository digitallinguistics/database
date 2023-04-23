export default function hasTranscription(txn, str) {

  for (const key in txn) {
    if (txn[key].includes(str)) return true
  }

  return false

}
