import { createHash } from 'node:crypto'
import { access, lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { writeImmutableArtifact } from './evidence-writer.js'
import {
  artifactTargetBindingSha256,
  exactArtifactTargetBindingMatch,
  validateArtifactTargetBinding,
  type ArtifactTargetBinding
} from './target-binding.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SAFE_FILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/
const MAX_ARTIFACTS = 128
const MAX_SEAL_BYTES = 256 * 1024
const MAX_VERIFY_ARTIFACT_BYTES = 16 * 1024 * 1024

const runIdSchema = z.string().uuid().or(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/))
const artifactRoleSchema = z.enum([
  'report', 'route-map-json', 'route-map-html', 'provider-evidence', 'other'
])
const artifactDescriptorSchema = z.strictObject({
  role: artifactRoleSchema,
  fileName: z.string().regex(SAFE_FILE_NAME),
  bytes: z.number().int().nonnegative().max(MAX_VERIFY_ARTIFACT_BYTES),
  sha256: z.string().regex(SHA256_PATTERN)
})
const bundlePayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: runIdSchema,
  scenarioSha256: z.string().regex(SHA256_PATTERN),
  capabilitySourceFingerprint: z.string().regex(SHA256_PATTERN).optional(),
  targetBindingSha256: z.string().regex(SHA256_PATTERN).optional(),
  artifacts: z.array(artifactDescriptorSchema).min(1).max(MAX_ARTIFACTS)
})
const evidenceBundleManifestSchema = bundlePayloadSchema.extend({
  bundleSha256: z.string().regex(SHA256_PATTERN)
})

export type EvidenceArtifactRole = z.infer<typeof artifactRoleSchema>
export type EvidenceArtifactDescriptor = z.infer<typeof artifactDescriptorSchema>
export type EvidenceBundleManifest = z.infer<typeof evidenceBundleManifestSchema>

export interface EvidenceBundleInput {
  runId: string
  scenarioSha256: string
  capabilitySourceFingerprint?: string
  targetBindingSha256?: string
  artifacts: Array<{
    role: EvidenceArtifactRole
    fileName: string
    content: string | Uint8Array
  }>
}

export interface ArtifactBoundBundleVerification {
  integrity: true
  expectedMatch: true
  evidenceGrade: 'artifact-bound'
  releaseEligible: false
  functionalVerdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  targetBindingSha256: string
}

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalPayload(payload: z.infer<typeof bundlePayloadSchema>): string {
  return JSON.stringify(payload)
}

function sealBytes(manifest: EvidenceBundleManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function validateFileName(fileName: string): string {
  if (!SAFE_FILE_NAME.test(fileName) || path.basename(fileName) !== fileName) {
    throw new Error(`Invalid evidence file name: ${fileName}`)
  }
  return fileName
}

function assertRunBinding(
  runId: string,
  sealFileName: string,
  artifacts: ReadonlyArray<{ role: EvidenceArtifactRole; fileName: string }>
): void {
  validateFileName(sealFileName)
  if (sealFileName !== `${runId}.bundle.json`) {
    throw new Error('Evidence bundle seal filename does not match runId')
  }
  const reports = artifacts.filter(artifact => artifact.role === 'report')
  if (reports.length !== 1 || reports[0]?.fileName !== `${runId}.json`) {
    throw new Error('Evidence report filename does not match runId')
  }
  if (artifacts.some(artifact => artifact.fileName !== `${runId}.json` && !artifact.fileName.startsWith(`${runId}-`))) {
    throw new Error('Evidence artifact filename does not match runId')
  }
}

async function assertDestinationMissing(directory: string, fileName: string): Promise<void> {
  try {
    await access(path.join(directory, fileName))
    throw new Error(`Evidence artifact already exists: ${fileName}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

async function readBoundedRegularFile(file: string, maxBytes: number): Promise<Buffer> {
  const before = await lstat(file)
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`Evidence path must be a regular file: ${path.basename(file)}`)
  }
  if (before.size > maxBytes) {
    throw new Error(`Evidence file exceeds verify bound: ${path.basename(file)}`)
  }
  const content = await readFile(file)
  const after = await lstat(file)
  if (
    !after.isFile()
    || after.isSymbolicLink()
    || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || before.ino !== after.ino
    || content.byteLength !== after.size
  ) {
    throw new Error(`Evidence file changed while reading: ${path.basename(file)}`)
  }
  return content
}

export async function writeEvidenceBundle(
  directory: string,
  sealFileName: string,
  input: EvidenceBundleInput
): Promise<EvidenceBundleManifest> {
  if (input.artifacts.length === 0 || input.artifacts.length > MAX_ARTIFACTS) {
    throw new Error('Evidence artifact count is outside bundle bounds')
  }
  const runId = runIdSchema.parse(input.runId)
  const scenarioSha256 = z.string().regex(SHA256_PATTERN).parse(input.scenarioSha256)
  const capabilitySourceFingerprint = input.capabilitySourceFingerprint === undefined
    ? undefined
    : z.string().regex(SHA256_PATTERN).parse(input.capabilitySourceFingerprint)
  const targetBindingSha256 = input.targetBindingSha256 === undefined
    ? undefined
    : z.string().regex(SHA256_PATTERN).parse(input.targetBindingSha256)
  const artifacts = input.artifacts.map(artifact => ({
    role: artifactRoleSchema.parse(artifact.role),
    fileName: validateFileName(artifact.fileName),
    content: Buffer.from(artifact.content)
  }))
  const names = artifacts.map(artifact => artifact.fileName)
  if (new Set(names).size !== names.length || names.includes(sealFileName)) {
    throw new Error('Duplicate evidence artifact file name')
  }
  assertRunBinding(runId, sealFileName, artifacts)

  await assertDestinationMissing(directory, sealFileName)
  for (const artifact of artifacts) await assertDestinationMissing(directory, artifact.fileName)

  const descriptors: EvidenceArtifactDescriptor[] = []
  for (const artifact of artifacts) {
    const persisted = await writeImmutableArtifact(directory, artifact.fileName, artifact.content)
    descriptors.push({
      role: artifact.role,
      fileName: persisted.fileName,
      bytes: persisted.bytes,
      sha256: persisted.sha256
    })
  }
  descriptors.sort((left, right) => compareText(left.fileName, right.fileName))

  const payload = bundlePayloadSchema.parse({
    schemaVersion: 1,
    runId,
    scenarioSha256,
    ...(capabilitySourceFingerprint
      ? { capabilitySourceFingerprint }
      : {}),
    ...(targetBindingSha256 ? { targetBindingSha256 } : {}),
    artifacts: descriptors
  })
  const manifest = evidenceBundleManifestSchema.parse({
    ...payload,
    bundleSha256: sha256(canonicalPayload(payload))
  })
  await writeImmutableArtifact(directory, sealFileName, sealBytes(manifest), { maxBytes: MAX_SEAL_BYTES })
  return manifest
}

async function verifyEvidenceBundleWithContent(
  directory: string,
  sealFileName: string
): Promise<{ manifest: EvidenceBundleManifest; contents: Map<string, Buffer> }> {
  if (!SAFE_FILE_NAME.test(sealFileName) || path.basename(sealFileName) !== sealFileName) {
    throw new Error(`Invalid evidence bundle file name: ${sealFileName}`)
  }
  const rawSeal = await readBoundedRegularFile(path.join(directory, sealFileName), MAX_SEAL_BYTES)
  const manifest = evidenceBundleManifestSchema.parse(JSON.parse(rawSeal.toString('utf8')))
  assertRunBinding(manifest.runId, sealFileName, manifest.artifacts)
  const { bundleSha256, ...payload } = manifest
  const expectedBundleSha256 = sha256(canonicalPayload(bundlePayloadSchema.parse(payload)))
  if (bundleSha256 !== expectedBundleSha256) throw new Error('Evidence bundle hash mismatch')

  const names = manifest.artifacts.map(artifact => artifact.fileName)
  if (new Set(names).size !== names.length || names.includes(sealFileName)) {
    throw new Error('Evidence bundle contains duplicate artifact')
  }
  const contents = new Map<string, Buffer>()
  for (const artifact of manifest.artifacts) {
    const content = await readBoundedRegularFile(
      path.join(directory, artifact.fileName),
      MAX_VERIFY_ARTIFACT_BYTES
    )
    if (content.byteLength !== artifact.bytes || sha256(content) !== artifact.sha256) {
      throw new Error(`Evidence artifact bytes/hash mismatch: ${artifact.fileName}`)
    }
    contents.set(artifact.fileName, content)
  }
  return { manifest, contents }
}

export async function verifyEvidenceBundle(
  directory: string,
  sealFileName: string
): Promise<EvidenceBundleManifest> {
  return (await verifyEvidenceBundleWithContent(directory, sealFileName)).manifest
}

const artifactBoundEvidenceSchema = z.strictObject({
  evidenceGrade: z.literal('artifact-bound'),
  releaseEligible: z.literal(false),
  targetBinding: z.unknown(),
  targetBindingSha256: z.string().regex(SHA256_PATTERN)
})

const artifactBoundReportSchema = z.object({
  runId: runIdSchema,
  verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  manifest: z.object({
    schemaVersion: z.literal(1),
    capability: z.object({ sourceFingerprint: z.string().regex(SHA256_PATTERN) }).optional(),
    evidence: z.unknown()
  })
})

export async function verifyArtifactBoundBundle(
  directory: string,
  sealFileName: string,
  expectedBinding: ArtifactTargetBinding
): Promise<ArtifactBoundBundleVerification> {
  const expected = validateArtifactTargetBinding(expectedBinding)
  const { manifest, contents } = await verifyEvidenceBundleWithContent(directory, sealFileName)
  if (!manifest.targetBindingSha256) throw new Error('Evidence bundle is not artifact-bound')

  const reportDescriptor = manifest.artifacts.find(artifact => artifact.role === 'report')
  if (!reportDescriptor) throw new Error('Evidence bundle report is unavailable')
  const reportBytes = contents.get(reportDescriptor.fileName)
  if (!reportBytes) throw new Error('Verified evidence report bytes are unavailable')

  let decoded: unknown
  try {
    decoded = JSON.parse(reportBytes.toString('utf8'))
  } catch (error) {
    throw new Error('Evidence report is not valid JSON', { cause: error })
  }
  const report = artifactBoundReportSchema.parse(decoded)
  if (report.runId !== manifest.runId) throw new Error('Evidence report runId does not match bundle runId')
  const reportCapabilityFingerprint = report.manifest.capability?.sourceFingerprint
  if (manifest.capabilitySourceFingerprint !== reportCapabilityFingerprint) {
    throw new Error('Capability source fingerprint does not match report')
  }
  const evidence = artifactBoundEvidenceSchema.parse(report.manifest.evidence)
  const actualBinding = validateArtifactTargetBinding(evidence.targetBinding)
  const actualHash = artifactTargetBindingSha256(actualBinding)
  if (evidence.targetBindingSha256 !== actualHash || manifest.targetBindingSha256 !== actualHash) {
    throw new Error('Target binding hash mismatch')
  }
  if (!exactArtifactTargetBindingMatch(actualBinding, expected)) {
    throw new Error('Target binding mismatch or stale expected target')
  }
  return {
    integrity: true,
    expectedMatch: true,
    evidenceGrade: 'artifact-bound',
    releaseEligible: false,
    functionalVerdict: report.verdict,
    targetBindingSha256: actualHash
  }
}
