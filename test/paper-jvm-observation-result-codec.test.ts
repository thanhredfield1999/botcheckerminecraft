import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  canonicalPaperJvmObservationResultV1,
  parseCanonicalPaperJvmObservationResultV1
} from '../src/paper-jvm-observation-result-codec.js'

const root = process.cwd()
const observerSource = path.join(root, 'java-src', 'vn', 'heomc', 'botchecker', 'probe', 'JvmArtifactObserver.java')
const portSource = path.join(root, 'java-src', 'vn', 'heomc', 'botchecker', 'probe', 'PaperJvmObservationPort.java')
const codecSource = path.join(root, 'java-src', 'vn', 'heomc', 'botchecker', 'probe', 'PaperJvmObservationResultCodec.java')

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  }).trim()
}

test('Paper JVM observation result codec Java→Node canonical parity', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-result-codec-'))
  const classes = path.join(directory, 'classes')
  mkdirSync(classes)
  try {
    const harness = path.join(directory, 'PaperJvmObservationResultCodecHarness.java')
    writeFileSync(harness, `
import java.util.Base64;
import java.util.List;
import vn.heomc.botchecker.probe.JvmArtifactObserver;
import vn.heomc.botchecker.probe.PaperJvmObservationPort;
import vn.heomc.botchecker.probe.PaperJvmObservationResultCodec;

public final class PaperJvmObservationResultCodecHarness {
  public static void main(String[] args) {
    var observation = new JvmArtifactObserver.Observation(
        JvmArtifactObserver.EVIDENCE_GRADE,
        false, false, false,
        List.of("standard-non-instrumented-anchor-classloader", "java-agent-absence-verified:false"),
        new JvmArtifactObserver.DeclaredIdentity(
            "candidate", "candidate", "plugins/Candidate.jar"),
        "fixture.𐐷Anchor",
        "${'5'.repeat(64)}", "${'1'.repeat(64)}", 1024L,
        "${'6'.repeat(64)}", 128L,
        "anchor-class-getResourceAsStream;loader-mediated;parent-delegation-possible;runtime-version-selection-unknown;may-differ-from-defined-bytecode;origin-not-proven",
        true, true, true,
        JvmArtifactObserver.InternalEntryConsistency.MATCH,
        false);
    var result = new PaperJvmObservationPort.Result(
        10_050L, "paper-instance-a", "paper-boot-a", observation);
    byte[] canonical = PaperJvmObservationResultCodec.canonicalJsonUtf8V1(result);
    System.out.print(Base64.getUrlEncoder().withoutPadding().encodeToString(canonical));
  }
}
`)
    run('javac', [
      '--release', '21', '-encoding', 'UTF-8', '-d', classes,
      observerSource, portSource, codecSource, harness
    ], directory)
    const encoded = run('java', ['-cp', classes, 'PaperJvmObservationResultCodecHarness'], directory)
    const bytes = Buffer.from(encoded, 'base64url')
    const parsed = parseCanonicalPaperJvmObservationResultV1(bytes)
    assert.equal(parsed.schemaVersion, 1)
    assert.equal(parsed.observedAtMs, 10_050)
    assert.equal(parsed.claimedServerInstanceId, 'paper-instance-a')
    assert.equal(parsed.claimedBootId, 'paper-boot-a')
    assert.equal(parsed.jvmArtifactObservation.observedClassBinaryName, 'fixture.𐐷Anchor')
    assert.equal(parsed.jvmArtifactObservation.authoritative, false)
    assert.equal(Object.isFrozen(parsed), true)
    assert.equal(Object.isFrozen(parsed.jvmArtifactObservation), true)
    assert.equal(Object.isFrozen(parsed.jvmArtifactObservation.declared), true)
    assert.equal(bytes.equals(canonicalPaperJvmObservationResultV1(parsed)), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Paper JVM observation result codec reject non-canonical, malformed và oversized bytes', () => {
  const observation = {
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
      logicalPath: 'plugins/Candidate.jar'
    },
    observedClassBinaryName: 'fixture.Anchor',
    codeSourceUriFingerprint: '5'.repeat(64),
    codeSourceFileSha256: '1'.repeat(64),
    codeSourceFileBytes: 1024,
    classResourceSha256: '6'.repeat(64),
    classResourceBytes: 128,
    classResourceOrigin: 'anchor-class-getResourceAsStream;loader-mediated;parent-delegation-possible;runtime-version-selection-unknown;may-differ-from-defined-bytecode;origin-not-proven' as const,
    classResourceInformational: true as const,
    sameLoaderMediated: true as const,
    mayDifferFromDefinedBytecode: true as const,
    internalEntryConsistency: 'MATCH' as const,
    atomicSnapshot: false as const
  }
  const value = {
    schemaVersion: 1 as const,
    observedAtMs: 10_050,
    claimedServerInstanceId: 'paper-instance-a',
    claimedBootId: 'paper-boot-a',
    jvmArtifactObservation: observation
  }
  const canonical = canonicalPaperJvmObservationResultV1(value)
  const parsed = parseCanonicalPaperJvmObservationResultV1(canonical)
  canonical.fill(0)
  assert.equal(parsed.claimedBootId, 'paper-boot-a')
  assert.equal(parsed.jvmArtifactObservation.declared.logicalId, 'candidate')

  const nonCanonical = Buffer.from(` ${canonicalPaperJvmObservationResultV1(value).toString('utf8')}`, 'utf8')
  assert.throws(() => parseCanonicalPaperJvmObservationResultV1(nonCanonical), /not canonical/)

  const extra = JSON.parse(canonicalPaperJvmObservationResultV1(value).toString('utf8')) as Record<string, unknown>
  extra['secret/transport/path'] = true
  assert.throws(
    () => parseCanonicalPaperJvmObservationResultV1(Buffer.from(JSON.stringify(extra))),
    error => error instanceof Error
      && error.message === 'Paper observation result is invalid'
      && !error.message.includes('secret')
  )
  assert.throws(
    () => parseCanonicalPaperJvmObservationResultV1(Uint8Array.from([0xc3, 0x28])),
    /JSON is invalid/
  )
  assert.throws(
    () => parseCanonicalPaperJvmObservationResultV1(Buffer.alloc(16 * 1024 + 1, 0x20)),
    /bytes are invalid/
  )
})

test('Paper JVM observation result codec sanitize hostile getter errors', () => {
  const hostile = Object.defineProperty({}, 'schemaVersion', {
    enumerable: true,
    get() {
      throw new Error('secret/production/key-path')
    }
  })
  assert.throws(
    () => canonicalPaperJvmObservationResultV1(hostile),
    error => error instanceof Error
      && error.message === 'Paper observation result is invalid'
      && !error.message.includes('secret')
  )

  const hostileBytes = new Proxy(new Uint8Array([0x7b, 0x7d]), {
    get(target, property, receiver) {
      if (property === 'byteLength') throw new Error('secret/transport/path')
      return Reflect.get(target, property, receiver)
    }
  })
  assert.throws(
    () => parseCanonicalPaperJvmObservationResultV1(hostileBytes),
    error => error instanceof Error
      && error.message === 'Paper observation result bytes are invalid'
      && !error.message.includes('secret')
  )
})
