import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_MAX_ARTIFACT_BYTES = 16 * 1024 * 1024
const SAFE_FILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/

export interface ImmutableArtifactResult {
  fileName: string
  bytes: number
  sha256: string
}

export interface ImmutableArtifactOptions {
  maxBytes?: number
}

function artifactBytes(content: string | Uint8Array): Uint8Array {
  return Buffer.from(content)
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

export async function writeImmutableArtifact(
  directory: string,
  fileName: string,
  content: string | Uint8Array,
  options: ImmutableArtifactOptions = {}
): Promise<ImmutableArtifactResult> {
  if (!SAFE_FILE_NAME.test(fileName) || path.basename(fileName) !== fileName) {
    throw new Error(`Invalid evidence file name: ${fileName}`)
  }

  const bytes = artifactBytes(content)
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_ARTIFACT_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('maxBytes must be a positive safe integer')
  if (bytes.byteLength > maxBytes) {
    throw new Error(`Evidence artifact exceeds ${maxBytes} bytes`)
  }

  await mkdir(directory, { recursive: true })
  const destination = path.join(directory, fileName)
  const temporary = path.join(directory, `.${fileName}.${randomUUID()}.tmp`)
  let temporaryExists = false

  try {
    const handle = await open(temporary, 'wx', 0o600)
    temporaryExists = true
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }

    try {
      await link(temporary, destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`Evidence artifact already exists: ${fileName}`, { cause: error })
      }
      throw error
    }

    const persisted = await readFile(destination)
    const expectedSha256 = sha256(bytes)
    const persistedSha256 = sha256(persisted)
    if (persisted.byteLength !== bytes.byteLength || persistedSha256 !== expectedSha256) {
      throw new Error(`Evidence artifact read-back mismatch: ${fileName}`)
    }

    return { fileName, bytes: bytes.byteLength, sha256: persistedSha256 }
  } finally {
    if (temporaryExists) await unlink(temporary).catch(() => {})
  }
}
