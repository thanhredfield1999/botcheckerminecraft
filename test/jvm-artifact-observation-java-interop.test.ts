import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  canonicalJvmArtifactObservationV1,
  parseJvmArtifactObservationV1,
  type JvmArtifactObservationV1
} from '../src/jvm-artifact-observation.js'

const observerSource = path.join(
  process.cwd(), 'java-src', 'vn', 'heomc', 'botchecker', 'probe', 'JvmArtifactObserver.java'
)

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  })
}

function runBytes(command: string, args: string[], cwd: string): Buffer {
  return execFileSync(command, args, {
    cwd,
    encoding: 'buffer',
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  })
}

function expectedObservation(): JvmArtifactObservationV1 {
  return {
    schemaVersion: 1,
    grade: 'codesource-file-and-class-resource-observed',
    authoritative: false,
    provesLoadedBytecode: false,
    releaseEligible: false,
    assumptions: [
      'standard-non-instrumented-anchor-classloader',
      'java-agent-absence-verified:false'
    ],
    declared: {
      role: 'candidate',
      logicalId: 'candidate',
      logicalPath: 'plugins/ItemGuard.jar'
    },
    observedClassBinaryName: 'com.example.itemguard.ItemGuardPlugin',
    codeSourceUriFingerprint: '4'.repeat(64),
    codeSourceFileSha256: '2'.repeat(64),
    codeSourceFileBytes: 65_536,
    classResourceSha256: '5'.repeat(64),
    classResourceBytes: 4_096,
    classResourceOrigin: 'anchor-class-getResourceAsStream;loader-mediated;parent-delegation-possible;runtime-version-selection-unknown;may-differ-from-defined-bytecode;origin-not-proven',
    classResourceInformational: true,
    sameLoaderMediated: true,
    mayDifferFromDefinedBytecode: true,
    internalEntryConsistency: 'MATCH',
    atomicSnapshot: false
  }
}

test('Java observation canonical JSON khớp byte-for-byte Node strict parser', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-jvm-observation-interop-'))
  const classes = path.join(directory, 'classes')
  mkdirSync(classes)
  try {
    const harness = path.join(directory, 'ObservationJsonHarness.java')
    writeFileSync(harness, `
import java.util.List;
import vn.heomc.botchecker.probe.JvmArtifactObserver;

public final class ObservationJsonHarness {
  public static void main(String[] args) {
    var observation = new JvmArtifactObserver.Observation(
      "codesource-file-and-class-resource-observed",
      false,
      false,
      false,
      List.of("standard-non-instrumented-anchor-classloader", "java-agent-absence-verified:false"),
      new JvmArtifactObserver.DeclaredIdentity("candidate", "candidate", "plugins/ItemGuard.jar"),
      "com.example.itemguard.ItemGuardPlugin",
      "${'4'.repeat(64)}",
      "${'2'.repeat(64)}",
      65536L,
      "${'5'.repeat(64)}",
      4096L,
      "anchor-class-getResourceAsStream;loader-mediated;parent-delegation-possible;runtime-version-selection-unknown;may-differ-from-defined-bytecode;origin-not-proven",
      true,
      true,
      true,
      JvmArtifactObserver.InternalEntryConsistency.MATCH,
      false
    );
    var unicodeObservation = new JvmArtifactObserver.Observation(
      observation.grade(), observation.authoritative(), observation.provesLoadedBytecode(),
      observation.releaseEligible(), observation.assumptions(), observation.declared(),
      "com.example.𐐀Plugin", observation.codeSourceUriFingerprint(),
      observation.codeSourceFileSha256(), observation.codeSourceFileBytes(),
      observation.classResourceSha256(), observation.classResourceBytes(),
      observation.classResourceOrigin(), observation.classResourceInformational(),
      observation.sameLoaderMediated(), observation.mayDifferFromDefinedBytecode(),
      observation.internalEntryConsistency(), observation.atomicSnapshot()
    );
    byte[] asciiBytes = JvmArtifactObserver.canonicalJsonUtf8V1(observation);
    byte[] unicodeBytes = JvmArtifactObserver.canonicalJsonUtf8V1(unicodeObservation);
    System.out.write(asciiBytes, 0, asciiBytes.length);
    System.out.write(10);
    System.out.write(unicodeBytes, 0, unicodeBytes.length);
  }
}
`)
    run('javac', ['--release', '21', '-encoding', 'UTF-8', '-d', classes, observerSource, harness], directory)
    const output = runBytes('java', ['-cp', classes, 'ObservationJsonHarness'], directory)
    const delimiter = output.indexOf(0x0a)
    assert.ok(delimiter > 0)
    const javaBytes = output.subarray(0, delimiter)
    const javaUnicodeBytes = output.subarray(delimiter + 1)
    const expected = expectedObservation()
    const unicodeExpected = { ...expected, observedClassBinaryName: 'com.example.𐐀Plugin' }

    assert.equal(javaBytes.equals(canonicalJvmArtifactObservationV1(expected)), true)
    assert.equal(javaUnicodeBytes.equals(canonicalJvmArtifactObservationV1(unicodeExpected)), true)
    assert.deepEqual(
      parseJvmArtifactObservationV1(JSON.parse(javaBytes.toString('utf8'))),
      parseJvmArtifactObservationV1(expected)
    )
    assert.deepEqual(
      parseJvmArtifactObservationV1(JSON.parse(javaUnicodeBytes.toString('utf8'))),
      parseJvmArtifactObservationV1(unicodeExpected)
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Java observation producer reject forged authoritative posture', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-jvm-observation-forgery-'))
  const classes = path.join(directory, 'classes')
  mkdirSync(classes)
  try {
    const harness = path.join(directory, 'ObservationForgeryHarness.java')
    writeFileSync(harness, `
import java.util.List;
import vn.heomc.botchecker.probe.JvmArtifactObserver;

public final class ObservationForgeryHarness {
  public static void main(String[] args) {
    try {
      new JvmArtifactObserver.Observation(
        "codesource-file-and-class-resource-observed",
        true,
        false,
        false,
        List.of("standard-non-instrumented-anchor-classloader", "java-agent-absence-verified:false"),
        new JvmArtifactObserver.DeclaredIdentity("candidate", "candidate", "plugins/ItemGuard.jar"),
        "com.example.itemguard.ItemGuardPlugin",
        "${'4'.repeat(64)}",
        "${'2'.repeat(64)}",
        65536L,
        "${'5'.repeat(64)}",
        4096L,
        "anchor-class-getResourceAsStream;loader-mediated;parent-delegation-possible;runtime-version-selection-unknown;may-differ-from-defined-bytecode;origin-not-proven",
        true,
        true,
        true,
        JvmArtifactObserver.InternalEntryConsistency.MATCH,
        false
      );
      System.out.print("UNEXPECTED_ACCEPT");
    } catch (IllegalArgumentException expected) {
      System.out.print("REJECTED");
    }
  }
}
`)
    run('javac', ['--release', '21', '-encoding', 'UTF-8', '-d', classes, observerSource, harness], directory)
    assert.equal(run('java', ['-cp', classes, 'ObservationForgeryHarness'], directory), 'REJECTED')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Java observation producer reject credential-like declared identity', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-jvm-observation-credential-'))
  const classes = path.join(directory, 'classes')
  mkdirSync(classes)
  try {
    const harness = path.join(directory, 'ObservationCredentialHarness.java')
    writeFileSync(harness, `
import vn.heomc.botchecker.probe.JvmArtifactObserver;
public final class ObservationCredentialHarness {
  public static void main(String[] args) {
    try {
      new JvmArtifactObserver.DeclaredIdentity(
        "candidate", "token-observation", "plugins/ItemGuard.jar");
      System.out.print("UNEXPECTED_ACCEPT");
    } catch (IllegalArgumentException expected) {
      System.out.print("REJECTED");
    }
    System.out.print("|");
    try {
      new JvmArtifactObserver.DeclaredIdentity(
        "candidate", "candidate", "plugins/My+Plugin.jar");
      System.out.print("UNEXPECTED_ACCEPT");
    } catch (IllegalArgumentException expected) {
      System.out.print("REJECTED");
    }
  }
}
`)
    run('javac', ['--release', '21', '-encoding', 'UTF-8', '-d', classes, observerSource, harness], directory)
    assert.equal(
      run('java', ['-cp', classes, 'ObservationCredentialHarness'], directory),
      'REJECTED|REJECTED'
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
