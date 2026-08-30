import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, truncate, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  verifyEvidenceBundle,
  verifyEvidenceBundleSnapshot,
  writeEvidenceBundle
} from '../src/evidence-bundle.js'

test('evidence bundle ghi artifacts create-new, seal canonical và verify read-back', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-bundle-'))
  try {
    const manifest = await writeEvidenceBundle(directory, 'run-1.bundle.json', {
      runId: 'run-1',
      scenarioSha256: '1'.repeat(64),
      capabilitySourceFingerprint: '2'.repeat(64),
      artifacts: [
        { role: 'report', fileName: 'run-1.json', content: '{"verdict":"PASS"}' },
        { role: 'route-map-json', fileName: 'run-1-route.json', content: '{"samples":[]}' }
      ]
    })

    assert.match(manifest.bundleSha256, /^[a-f0-9]{64}$/)
    assert.deepEqual(manifest.artifacts.map(artifact => artifact.fileName), ['run-1-route.json', 'run-1.json'])
    assert.deepEqual((await verifyEvidenceBundle(directory, 'run-1.bundle.json')), manifest)
    assert.deepEqual(new Set(await readdir(directory)), new Set(['run-1.bundle.json', 'run-1-route.json', 'run-1.json']))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('evidence bundle verifier từ chối artifact thiếu hoặc bị sửa', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-bundle-tamper-'))
  try {
    await writeEvidenceBundle(directory, 'run-2.bundle.json', {
      runId: 'run-2', scenarioSha256: '3'.repeat(64),
      artifacts: [{ role: 'report', fileName: 'run-2.json', content: 'original' }]
    })

    await writeFile(path.join(directory, 'run-2.json'), 'tampered')
    await assert.rejects(verifyEvidenceBundle(directory, 'run-2.bundle.json'), /hash|bytes/i)

    await unlink(path.join(directory, 'run-2.json'))
    await assert.rejects(verifyEvidenceBundle(directory, 'run-2.bundle.json'), /artifact|ENOENT/i)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('evidence bundle verifier từ chối unknown field và bundle hash sai', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-bundle-schema-'))
  try {
    await writeEvidenceBundle(directory, 'run-3.bundle.json', {
      runId: 'run-3', scenarioSha256: '4'.repeat(64),
      artifacts: [{ role: 'report', fileName: 'run-3.json', content: 'report' }]
    })
    const sealPath = path.join(directory, 'run-3.bundle.json')
    const seal = JSON.parse(await readFile(sealPath, 'utf8')) as Record<string, unknown>
    seal.unknown = true
    await writeFile(sealPath, JSON.stringify(seal))

    await assert.rejects(verifyEvidenceBundle(directory, 'run-3.bundle.json'), /unknown|schema/i)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('evidence bundle collision không overwrite bundle đầu tiên', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-bundle-collision-'))
  try {
    const input = {
      runId: 'run-4', scenarioSha256: '5'.repeat(64),
      artifacts: [{ role: 'report' as const, fileName: 'run-4.json', content: 'first' }]
    }
    await writeEvidenceBundle(directory, 'run-4.bundle.json', input)
    const firstSeal = await readFile(path.join(directory, 'run-4.bundle.json'))

    await assert.rejects(writeEvidenceBundle(directory, 'run-4.bundle.json', {
      ...input,
      artifacts: [{ role: 'report', fileName: 'run-4.json', content: 'second' }]
    }), /already exists/i)
    assert.deepEqual(await readFile(path.join(directory, 'run-4.bundle.json')), firstSeal)
    assert.equal(await readFile(path.join(directory, 'run-4.json'), 'utf8'), 'first')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('evidence bundle verifier từ chối non-regular và oversized artifact trước khi đọc', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-bundle-bounds-'))
  try {
    await writeEvidenceBundle(directory, 'run-5.bundle.json', {
      runId: 'run-5', scenarioSha256: '6'.repeat(64),
      artifacts: [{ role: 'report', fileName: 'run-5.json', content: 'report' }]
    })
    const artifactPath = path.join(directory, 'run-5.json')

    await unlink(artifactPath)
    await mkdir(artifactPath)
    await assert.rejects(verifyEvidenceBundle(directory, 'run-5.bundle.json'), /regular file/i)

    await rm(artifactPath, { recursive: true, force: true })
    await writeFile(artifactPath, '')
    await truncate(artifactPath, 16 * 1024 * 1024 + 1)
    await assert.rejects(verifyEvidenceBundle(directory, 'run-5.bundle.json'), /verify bound/i)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('evidence bundle snapshot toàn bộ artifact bytes trước await', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-bundle-snapshot-'))
  const mutable = new TextEncoder().encode('before')
  try {
    const writing = writeEvidenceBundle(directory, 'run-6.bundle.json', {
      runId: 'run-6', scenarioSha256: '7'.repeat(64),
      artifacts: [
        { role: 'report', fileName: 'run-6.json', content: 'report' },
        { role: 'other', fileName: 'run-6-mutable.bin', content: mutable }
      ]
    })
    mutable.set(new TextEncoder().encode('after!'))
    await writing

    assert.equal(await readFile(path.join(directory, 'run-6-mutable.bin'), 'utf8'), 'before')
    await verifyEvidenceBundle(directory, 'run-6.bundle.json')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('evidence bundle bind seal và report filename với runId', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-bundle-run-bind-'))
  try {
    await assert.rejects(writeEvidenceBundle(directory, 'other.bundle.json', {
      runId: 'run-7', scenarioSha256: '8'.repeat(64),
      artifacts: [{ role: 'report', fileName: 'run-7.json', content: 'report' }]
    }), /seal.*runId/i)
    await assert.rejects(writeEvidenceBundle(directory, 'run-7.bundle.json', {
      runId: 'run-7', scenarioSha256: '8'.repeat(64),
      artifacts: [{ role: 'report', fileName: 'other.json', content: 'report' }]
    }), /report.*runId/i)
    assert.deepEqual(await readdir(directory), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('verified evidence snapshot chỉ expose immutable canonical base64', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-bundle-snapshot-api-'))
  try {
    await writeEvidenceBundle(directory, 'run-8.bundle.json', {
      runId: 'run-8', scenarioSha256: '9'.repeat(64),
      artifacts: [{ role: 'report', fileName: 'run-8.json', content: 'verified-bytes' }]
    })
    const snapshot = await verifyEvidenceBundleSnapshot(directory, 'run-8.bundle.json')
    assert.equal(Object.isFrozen(snapshot), true)
    assert.equal(Object.isFrozen(snapshot.manifest), true)
    assert.equal(Object.isFrozen(snapshot.manifest.artifacts), true)
    assert.equal(Object.isFrozen(snapshot.manifest.artifacts[0]), true)
    assert.equal(Object.isFrozen(snapshot.artifacts), true)
    assert.equal(Object.isFrozen(snapshot.artifacts[0]), true)
    assert.equal(snapshot.artifacts[0]?.contentBase64, Buffer.from('verified-bytes').toString('base64'))
    assert.equal('content' in (snapshot.artifacts[0] ?? {}), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('evidence bundle verifier reject aggregate descriptor bytes trước artifact I/O', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-bundle-aggregate-'))
  try {
    const payload = {
      schemaVersion: 1,
      runId: 'run-9',
      scenarioSha256: '9'.repeat(64),
      artifacts: Array.from({ length: 5 }, (_, index) => ({
        role: index === 0 ? 'report' : 'other',
        fileName: index === 0 ? 'run-9.json' : `run-9-${index}.bin`,
        bytes: 16 * 1024 * 1024,
        sha256: `${index}`.repeat(64)
      }))
    }
    const manifest = {
      ...payload,
      bundleSha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    }
    await writeFile(path.join(directory, 'run-9.bundle.json'), JSON.stringify(manifest))
    await assert.rejects(
      verifyEvidenceBundle(directory, 'run-9.bundle.json'),
      /aggregate.*byte|byte.*aggregate/i
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('evidence bundle writer reject aggregate bytes trước persist', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-bundle-write-aggregate-'))
  const shared = new Uint8Array(13 * 1024 * 1024)
  try {
    await assert.rejects(writeEvidenceBundle(directory, 'run-10.bundle.json', {
      runId: 'run-10',
      scenarioSha256: 'a'.repeat(64),
      artifacts: Array.from({ length: 5 }, (_, index) => ({
        role: index === 0 ? 'report' as const : 'other' as const,
        fileName: index === 0 ? 'run-10.json' : `run-10-${index}.bin`,
        content: shared
      }))
    }), /aggregate.*byte|byte.*aggregate/i)
    assert.deepEqual(await readdir(directory), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('evidence bundle writer reject Proxy cardinality trước persist', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-bundle-proxy-count-'))
  const target = Array.from({ length: 129 }, (_, index) => ({
    role: index === 0 ? 'report' as const : 'other' as const,
    fileName: index === 0 ? 'run-11.json' : `run-11-${index}.bin`,
    content: 'x'
  }))
  let lengthReads = 0
  const artifacts = new Proxy(target, {
    get(value, property, receiver) {
      if (property === 'length') {
        lengthReads += 1
        return lengthReads <= 2 ? 1 : 129
      }
      return Reflect.get(value, property, receiver)
    }
  })
  try {
    await assert.rejects(writeEvidenceBundle(directory, 'run-11.bundle.json', {
      runId: 'run-11', scenarioSha256: 'b'.repeat(64), artifacts
    }), /cardinality|artifact count|proxy/i)
    assert.deepEqual(await readdir(directory), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('evidence bundle writer reject Proxy nói dối ownKeys và length', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-bundle-proxy-ownkeys-'))
  const target = Array.from({ length: 129 }, (_, index) => ({
    role: index === 0 ? 'report' as const : 'other' as const,
    fileName: index === 0 ? 'run-12.json' : `run-12-${index}.bin`,
    content: 'x'
  }))
  const artifacts = new Proxy(target, {
    get(value, property, receiver) {
      if (property === 'length') return 1
      return Reflect.get(value, property, receiver)
    },
    ownKeys() { return ['0', 'length'] }
  })
  try {
    await assert.rejects(writeEvidenceBundle(directory, 'run-12.bundle.json', {
      runId: 'run-12', scenarioSha256: 'c'.repeat(64), artifacts
    }), /proxy|cardinality|artifact count/i)
    assert.deepEqual(await readdir(directory), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
