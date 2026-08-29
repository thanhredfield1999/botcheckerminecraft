const PROJECT_ID = '[a-z][a-z0-9-]{4,28}[a-z0-9]'
const PROJECT_NUMBER = '[1-9][0-9]{0,18}'
const PROJECT = `(?:${PROJECT_ID}|${PROJECT_NUMBER})`
const SEGMENT = '[a-zA-Z0-9_-]{1,63}'
const LOCATION = '[a-z0-9-]{1,63}'
const VERSION = '[1-9][0-9]{0,18}'
const RESOURCE = new RegExp(
  `^projects\\/(${PROJECT})\\/locations\\/${LOCATION}`
  + `\\/keyRings\\/${SEGMENT}\\/cryptoKeys\\/${SEGMENT}`
  + `\\/cryptoKeyVersions\\/${VERSION}$`
)
const SIGNED_INT64_MAX = 9_223_372_036_854_775_807n

export function isGoogleCloudKmsCryptoKeyVersionName(input: unknown): input is string {
  if (typeof input !== 'string') return false
  const match = RESOURCE.exec(input)
  if (!match) return false
  const project = match[1]
  return !/^[0-9]+$/.test(project) || BigInt(project) <= SIGNED_INT64_MAX
}
