import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPaperJvmObservationByteProvider,
  type PaperJvmObservationByteSource
} from '../src/paper-jvm-observation-byte-provider.js'
import { canonicalPaperJvmObservationResultV1 } from '../src/paper-jvm-observation-result-codec.js'
import type { SignedProviderObservationRequest } from '../src/signed-provider-observer-signing-pipeline.js'

function observation() {
  return {
    schemaVersion: 1 as const,
    grade: 'codesource-file-and-class-resource-observed' as const,
    authoritative: false as const,
    provesLoadedBytecode: false as const,
    releaseEligible: false as const,
    assumptions: [
      'standard-non-instrumented-anchor-classloader',
      'java-agent-absence-verified:false'
    ] as const,
    declared: {
      role: 'candidate' as const,
      logicalId: 'candidate',
      logicalPath: 'plugins/LivingNPC.jar'
    },
    observedClassBinaryName: 'vn.heomc.livingnpc.LivingNpcPlugin',
    codeSourceUriFingerprint: '5'.repeat(64),
    codeSourceFileSha256: '1'.repeat(64),
    codeSourceFileBytes: 65_536,
    classResourceSha256: '6'.repeat(64),
    classResourceBytes: 4_096,
    classResourceOrigin: 'anchor-class-getResourceAsStream;loader-mediated;parent-delegation-possible;runtime-version-selection-unknown;may-differ-from-defined-bytecode;origin-not-proven' as const,
    classResourceInformational: true as const,
    sameLoaderMediated: true as const,
    mayDifferFromDefinedBytecode: true as const,
    internalEntryConsistency: 'MATCH' as const,
    atomicSnapshot: false as const
  }
}

function request(signal = new AbortController().signal): Readonly<SignedProviderObservationRequest> {
  return Object.freeze({
    challenge: Object.freeze({}) as SignedProviderObservationRequest['challenge'],
    candidate: Object.freeze({
      role: 'candidate' as const,
      logicalId: 'candidate',
      logicalPath: 'plugins/LivingNPC.jar',
      expectedSha256: '1'.repeat(64)
    }),
    signal
  })
}

test('canonical-byte provider parse owned frozen observation result và forward exact request', async () => {
  const result = {
    schemaVersion: 1 as const,
    observedAtMs: 10_050,
    claimedServerInstanceId: 'claimed-paper-instance-a',
    claimedBootId: 'claimed-paper-boot-a',
    jvmArtifactObservation: observation()
  }
  const bytes = canonicalPaperJvmObservationResultV1(result)
  const sourceCalls: Readonly<SignedProviderObservationRequest>[] = []
  const source: PaperJvmObservationByteSource = input => {
    sourceCalls.push(input)
    return bytes
  }
  const provider = createPaperJvmObservationByteProvider(source)
  const input = request()

  const actual = await provider(input)
  bytes.fill(0)

  assert.deepEqual(sourceCalls, [input])
  assert.equal(Object.isFrozen(actual), true)
  assert.equal(Object.isFrozen(actual.jvmArtifactObservation), true)
  assert.equal(actual.observedAtMs, 10_050)
  assert.equal(actual.jvmArtifactObservation.codeSourceFileSha256, '1'.repeat(64))
})

test('canonical-byte provider fail closed trước source khi signal đã abort', async () => {
  const controller = new AbortController()
  controller.abort(new Error('secret/abort/reason'))
  let calls = 0
  const provider = createPaperJvmObservationByteProvider(() => {
    calls += 1
    return new Uint8Array()
  })

  await assert.rejects(
    async () => await provider(request(controller.signal)),
    (error: unknown) => {
      assert.equal(String(error), 'Error: Paper observation byte request cancelled')
      assert.equal(String(error).includes('secret'), false)
      return true
    }
  )
  assert.equal(calls, 0)
})

test('canonical-byte provider sanitize hostile AbortSignal Proxy trước source', async () => {
  const sensitive = 'secret/signal/path'
  const hostileSignal = new Proxy(new AbortController().signal, {
    get(target, property, receiver) {
      if (property === 'aborted') throw new Error(sensitive)
      return Reflect.get(target, property, receiver)
    }
  })
  let calls = 0
  const provider = createPaperJvmObservationByteProvider(() => {
    calls += 1
    return new Uint8Array()
  })

  await assert.rejects(
    async () => await provider(request(hostileSignal)),
    (error: unknown) => {
      assert.equal(String(error), 'Error: Paper observation byte request is invalid')
      assert.equal(String(error).includes(sensitive), false)
      return true
    }
  )
  assert.equal(calls, 0)
})

test('canonical-byte provider sanitize hostile request Proxy và rejected thenable', async () => {
  const sensitive = 'secret/request/path'
  const hostileRequest = new Proxy(request(), {
    get(target, property, receiver) {
      if (property === 'signal') throw new Error(sensitive)
      return Reflect.get(target, property, receiver)
    }
  })
  let calls = 0
  const provider = createPaperJvmObservationByteProvider(() => {
    calls += 1
    return new Uint8Array()
  })
  await assert.rejects(
    async () => await provider(hostileRequest),
    (error: unknown) => {
      assert.equal(String(error), 'Error: Paper observation byte request is invalid')
      assert.equal(String(error).includes(sensitive), false)
      return true
    }
  )
  assert.equal(calls, 0)

  const thenable = createPaperJvmObservationByteProvider(() => ({
    get then() { throw new Error(sensitive) }
  }) as unknown as Promise<Uint8Array>)
  await assert.rejects(
    async () => await thenable(request()),
    (error: unknown) => {
      assert.equal(String(error), 'Error: Paper observation byte source failed')
      assert.equal(String(error).includes(sensitive), false)
      return true
    }
  )
})

test('canonical-byte provider reject result khi signal abort trong source callback', async () => {
  const controller = new AbortController()
  const provider = createPaperJvmObservationByteProvider(() => {
    controller.abort(new Error('secret/source/abort'))
    return canonicalPaperJvmObservationResultV1({
      schemaVersion: 1,
      observedAtMs: 10_050,
      claimedServerInstanceId: 'claimed-paper-instance-a',
      claimedBootId: 'claimed-paper-boot-a',
      jvmArtifactObservation: observation()
    })
  })

  await assert.rejects(
    async () => await provider(request(controller.signal)),
    (error: unknown) => {
      assert.equal(String(error), 'Error: Paper observation byte request cancelled')
      assert.equal(String(error).includes('secret'), false)
      return true
    }
  )
})

test('canonical-byte provider sanitize hostile byte Proxy từ source', async () => {
  const sensitive = 'secret/byte/path'
  const bytes = canonicalPaperJvmObservationResultV1({
    schemaVersion: 1,
    observedAtMs: 10_050,
    claimedServerInstanceId: 'claimed-paper-instance-a',
    claimedBootId: 'claimed-paper-boot-a',
    jvmArtifactObservation: observation()
  })
  const hostile = new Proxy(bytes, {
    get(target, property, receiver) {
      if (property === 'byteLength') throw new Error(sensitive)
      return Reflect.get(target, property, receiver)
    }
  })
  const provider = createPaperJvmObservationByteProvider(() => hostile)

  await assert.rejects(
    async () => await provider(request()),
    (error: unknown) => {
      assert.equal(String(error), 'Error: Paper observation byte source returned invalid bytes')
      assert.equal(String(error).includes(sensitive), false)
      return true
    }
  )
})

test('canonical-byte provider sanitize source và malformed-byte errors', async () => {
  const sensitive = 'secret/provider/path'
  const failed = createPaperJvmObservationByteProvider(() => {
    throw new Error(sensitive)
  })
  await assert.rejects(
    async () => await failed(request()),
    (error: unknown) => {
      assert.equal(String(error), 'Error: Paper observation byte source failed')
      assert.equal(String(error).includes(sensitive), false)
      return true
    }
  )

  const malformed = createPaperJvmObservationByteProvider(() => Buffer.from('{"bad":true}', 'utf8'))
  await assert.rejects(
    async () => await malformed(request()),
    (error: unknown) => {
      assert.equal(String(error), 'Error: Paper observation byte source returned invalid bytes')
      assert.equal(String(error).includes('Zod'), false)
      return true
    }
  )
})

test('canonical-byte provider reject invalid source constructor input', () => {
  assert.throws(
    () => createPaperJvmObservationByteProvider(undefined as unknown as PaperJvmObservationByteSource),
    /byte source is invalid/
  )
})
