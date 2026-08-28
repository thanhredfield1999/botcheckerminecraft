import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { canonicalSignedProviderObservationBoundClaimV2 } from '../src/signed-provider-claim.js'

const javaInteropAvailable = spawnSync('javac', ['--release', '21', '-version'], {
  encoding: 'utf8', windowsHide: true
}).status === 0

const claims = {
  schemaVersion: 1 as const,
  domain: 'botcheckerminecraft.signed-provider-claim.v1' as const,
  requiredClaimProfile: 'jvm-observation-bound-v2' as const,
  audience: 'builder-audience',
  verifierInstanceId: 'builder-verifier',
  sequence: 7,
  challengeId: 'a'.repeat(64),
  nonceBase64Url: Buffer.alloc(32, 1).toString('base64url'),
  runId: 'builder-run',
  keyId: 'b'.repeat(64),
  bindingId: 'builder-binding',
  targetBindingSha256: 'c'.repeat(64),
  provider: {
    kind: 'server-probe' as const,
    id: 'builder-probe',
    version: '1.0.0'
  },
  trustStoreId: 'builder-trust',
  trustStoreVersion: '2026.08.28-1',
  trustStoreSha256: 'd'.repeat(64),
  issuedAtMs: 10_000,
  expiresAtMs: 15_000,
  observedAtMs: 10_050,
  claimedServerInstanceId: 'claimed-builder-server',
  claimedBootId: 'claimed-builder-boot',
  loadedArtifacts: [
    { logicalId: 'probe', role: 'probe' as const, logicalPath: 'plugins/Probe.jar', sha256: '4'.repeat(64) },
    { logicalId: 'candidate', role: 'candidate' as const, logicalPath: 'plugins/Example.jar', sha256: '1'.repeat(64) },
    { logicalId: 'paper', role: 'paper' as const, logicalPath: 'server/paper.jar', sha256: '3'.repeat(64) },
    { logicalId: 'config', role: 'config' as const, logicalPath: 'plugins/Example/config.yml', sha256: '2'.repeat(64) }
  ]
}

const observation = {
  schemaVersion: 1 as const,
  grade: 'codesource-file-and-class-resource-observed' as const,
  authoritative: false as const,
  provesLoadedBytecode: false as const,
  releaseEligible: false as const,
  assumptions: [
    'standard-non-instrumented-anchor-classloader' as const,
    'java-agent-absence-verified:false' as const
  ],
  declared: {
    role: 'candidate' as const,
    logicalId: 'candidate',
    logicalPath: 'plugins/Example.jar'
  },
  observedClassBinaryName: 'com.example.𐐷Plugin',
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

const harnessSource = `
import java.util.Base64;
import java.util.ArrayList;
import java.util.List;
import vn.heomc.botchecker.probe.JvmArtifactObserver;
import vn.heomc.botchecker.probe.JvmObservationBoundClaimBuilder;

public final class BuilderHarness {
  public static void main(String[] args) {
    String providerInstanceId = args.length == 0 ? null : "builder-slot-a";
    var sourceArtifacts = new ArrayList<JvmObservationBoundClaimBuilder.Artifact>(List.of(
      new JvmObservationBoundClaimBuilder.Artifact(
        "probe", "probe", "plugins/Probe.jar", "${'4'.repeat(64)}"),
      new JvmObservationBoundClaimBuilder.Artifact(
        "candidate", "candidate", "plugins/Example.jar", "${'1'.repeat(64)}"),
      new JvmObservationBoundClaimBuilder.Artifact(
        "paper", "paper", "server/paper.jar", "${'3'.repeat(64)}"),
      new JvmObservationBoundClaimBuilder.Artifact(
        "config", "config", "plugins/Example/config.yml", "${'2'.repeat(64)}")
    ));
    var claims = new JvmObservationBoundClaimBuilder.Claims(
      1,
      "botcheckerminecraft.signed-provider-claim.v1",
      "jvm-observation-bound-v2",
      "builder-audience",
      "builder-verifier",
      7L,
      "${'a'.repeat(64)}",
      "${Buffer.alloc(32, 1).toString('base64url')}",
      "builder-run",
      "${'b'.repeat(64)}",
      "builder-binding",
      "${'c'.repeat(64)}",
      new JvmObservationBoundClaimBuilder.Provider(
        "server-probe", "builder-probe", "1.0.0", providerInstanceId),
      "builder-trust",
      "2026.08.28-1",
      "${'d'.repeat(64)}",
      10000L,
      15000L,
      10050L,
      "claimed-builder-server",
      "claimed-builder-boot",
      sourceArtifacts
    );
    sourceArtifacts.clear();
    var observation = new JvmArtifactObserver.Observation(
      JvmArtifactObserver.EVIDENCE_GRADE,
      false,
      false,
      false,
      List.of("standard-non-instrumented-anchor-classloader", "java-agent-absence-verified:false"),
      new JvmArtifactObserver.DeclaredIdentity(
        "candidate", "candidate", "plugins/Example.jar"),
      "com.example.𐐷Plugin",
      "${'5'.repeat(64)}",
      "${'1'.repeat(64)}",
      65536L,
      "${'6'.repeat(64)}",
      4096L,
      "anchor-class-getResourceAsStream;loader-mediated;parent-delegation-possible;runtime-version-selection-unknown;may-differ-from-defined-bytecode;origin-not-proven",
      true,
      true,
      true,
      JvmArtifactObserver.InternalEntryConsistency.MATCH,
      false
    );
    byte[] first = JvmObservationBoundClaimBuilder.canonicalJsonUtf8V2(
      new JvmObservationBoundClaimBuilder.Input(claims, observation));
    first[0] = 0;
    byte[] canonical = JvmObservationBoundClaimBuilder.canonicalJsonUtf8V2(
      new JvmObservationBoundClaimBuilder.Input(claims, observation));
    System.out.print(Base64.getUrlEncoder().withoutPadding().encodeToString(canonical));
  }
}
`

test('Java 21 production builder parity Unicode, instance optional và immutable snapshot', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-java-production-builder-'))
  try {
    const classesPath = path.join(workspace, 'classes')
    const harnessPath = path.join(workspace, 'BuilderHarness.java')
    mkdirSync(classesPath)
    writeFileSync(harnessPath, harnessSource, 'utf8')
    const observerSource = path.resolve(
      'java-src/vn/heomc/botchecker/probe/JvmArtifactObserver.java'
    )
    const builderSource = path.resolve(
      'java-src/vn/heomc/botchecker/probe/JvmObservationBoundClaimBuilder.java'
    )
    const sources = [observerSource, builderSource, harnessPath]
    execFileSync('javac', ['--release', '21', '-encoding', 'UTF-8', '-d', classesPath, ...sources], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    for (const withInstanceId of [false, true]) {
      const encoded = execFileSync('java', [
        '-cp', classesPath, 'BuilderHarness', ...(withInstanceId ? ['with-instance'] : [])
      ], {
        cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
      }).trim()
      assert.equal(
        Buffer.from(encoded, 'base64url').equals(
          canonicalSignedProviderObservationBoundClaimV2({
            claims: {
              ...claims,
              provider: {
                ...claims.provider,
                ...(withInstanceId ? { instanceId: 'builder-slot-a' } : {})
              }
            },
            jvmArtifactObservation: observation
          })
        ),
        true
      )
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
