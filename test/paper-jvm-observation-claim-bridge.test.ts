import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { canonicalSignedProviderObservationBoundClaimV2 } from '../src/signed-provider-claim.js'
import { parseSignedProviderCanonicalContent } from '../src/signed-provider-claim-schema.js'

const root = process.cwd()
const packageRoot = path.join(root, 'java-src', 'vn', 'heomc', 'botchecker', 'probe')
const javaSources = [
  'JvmArtifactObserver.java',
  'JvmObservationBoundClaimBuilder.java',
  'PaperJvmObservationPort.java',
  'PaperJvmObservationClaimBridge.java'
].map(file => path.join(packageRoot, file))

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true
  }).trim()
}

test('Paper observation result bind canonical claim bytes parity với Node', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-claim-bridge-'))
  const fixtureSource = path.join(directory, 'fixture-src')
  const fixtureClasses = path.join(directory, 'fixture-classes')
  const harnessClasses = path.join(directory, 'harness-classes')
  mkdirSync(path.join(fixtureSource, 'fixture'), { recursive: true })
  mkdirSync(fixtureClasses)
  mkdirSync(harnessClasses)
  try {
    writeFileSync(path.join(fixtureSource, 'fixture', 'Anchor.java'), `
package fixture;
public final class Anchor { }
`)
    run('javac', ['--release', '21', '-encoding', 'UTF-8', '-d', fixtureClasses,
      path.join(fixtureSource, 'fixture', 'Anchor.java')], directory)
    const fixtureJar = path.join(directory, 'candidate.jar')
    run('jar', ['--create', '--file', fixtureJar, '-C', fixtureClasses, '.'], directory)

    const harness = path.join(directory, 'PaperJvmObservationClaimBridgeHarness.java')
    writeFileSync(harness, `
import java.net.URLClassLoader;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import vn.heomc.botchecker.probe.JvmArtifactObserver;
import vn.heomc.botchecker.probe.JvmObservationBoundClaimBuilder;
import vn.heomc.botchecker.probe.PaperJvmObservationClaimBridge;
import vn.heomc.botchecker.probe.PaperJvmObservationPort;

public final class PaperJvmObservationClaimBridgeHarness {
  public static void main(String[] args) throws Exception {
    var mainThread = Thread.currentThread();
    try (var loader = new URLClassLoader(
        new java.net.URL[] { Path.of(args[0]).toUri().toURL() },
        ClassLoader.getPlatformClassLoader())) {
      Class<?> anchor = Class.forName("fixture.Anchor", true, loader);
      var context = PaperJvmObservationPort.capture(
          () -> Thread.currentThread() == mainThread,
          anchor,
          new JvmArtifactObserver.DeclaredIdentity(
              "candidate", "candidate", "plugins/Candidate.jar"),
          new JvmArtifactObserver.Limits(4 * 1024 * 1024, 1024 * 1024),
          "paper-instance-a", "paper-boot-a");
      var result = new AtomicReference<PaperJvmObservationPort.Result>();
      var failure = new AtomicReference<Throwable>();
      Thread.ofPlatform().start(() -> {
        try {
          result.set(PaperJvmObservationPort.observe(
              context,
              () -> Thread.currentThread() == mainThread,
              () -> 10_050L));
        } catch (Throwable error) {
          failure.set(error);
        }
      }).join();
      if (failure.get() != null) throw new RuntimeException(failure.get());
      var observed = result.get();
      var claims = new JvmObservationBoundClaimBuilder.Claims(
          1,
          JvmObservationBoundClaimBuilder.DOMAIN,
          JvmObservationBoundClaimBuilder.PROFILE,
          "paper-audience",
          "paper-verifier",
          7L,
          "${'a'.repeat(64)}",
          "${Buffer.alloc(32, 1).toString('base64url')}",
          "paper-run",
          "${'b'.repeat(64)}",
          "paper-binding",
          "${'c'.repeat(64)}",
          new JvmObservationBoundClaimBuilder.Provider(
              "server-probe", "paper-probe", "1.0.0", null),
          "paper-trust",
          "2026.08.30-1",
          "${'d'.repeat(64)}",
          10_000L,
          15_000L,
          observed.observedAtMs(),
          observed.claimedServerInstanceId(),
          observed.claimedBootId(),
          List.of(
              new JvmObservationBoundClaimBuilder.Artifact(
                  "probe", "probe", "plugins/Probe.jar", "${'4'.repeat(64)}"),
              new JvmObservationBoundClaimBuilder.Artifact(
                  "candidate", "candidate", "plugins/Candidate.jar",
                  observed.observation().codeSourceFileSha256()),
              new JvmObservationBoundClaimBuilder.Artifact(
                  "paper", "paper", "server/paper.jar", "${'3'.repeat(64)}"),
              new JvmObservationBoundClaimBuilder.Artifact(
                  "config", "config", "plugins/Candidate/config.yml", "${'2'.repeat(64)}")
          ));
      byte[] canonical = PaperJvmObservationClaimBridge.canonicalJsonUtf8V2(claims, observed);
      System.out.print(Base64.getUrlEncoder().withoutPadding().encodeToString(canonical));
    }
  }
}
`)
    run('javac', [
      '--release', '21', '-encoding', 'UTF-8', '-d', harnessClasses,
      ...javaSources, harness
    ], directory)
    const encoded = run('java', [
      '-cp', harnessClasses, 'PaperJvmObservationClaimBridgeHarness', fixtureJar
    ], directory)
    const canonical = Buffer.from(encoded, 'base64url')
    const content = parseSignedProviderCanonicalContent(JSON.parse(canonical.toString('utf8')))
    assert.equal(content.schemaVersion, 2)
    assert.equal(content.claims.observedAtMs, 10_050)
    assert.equal(content.claims.claimedServerInstanceId, 'paper-instance-a')
    assert.equal(content.claims.claimedBootId, 'paper-boot-a')
    assert.equal(content.jvmArtifactObservation.authoritative, false)
    assert.equal(content.jvmArtifactObservation.provesLoadedBytecode, false)
    assert.equal(content.jvmArtifactObservation.releaseEligible, false)
    assert.equal(canonical.equals(canonicalSignedProviderObservationBoundClaimV2({
      claims: content.claims,
      jvmArtifactObservation: content.jvmArtifactObservation
    })), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Paper observation claim bridge reject metadata mismatch trước canonical output', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-claim-bridge-guards-'))
  const classes = path.join(directory, 'classes')
  mkdirSync(classes)
  try {
    const harness = path.join(directory, 'PaperJvmObservationClaimBridgeGuardHarness.java')
    writeFileSync(harness, `
import java.util.List;
import vn.heomc.botchecker.probe.JvmArtifactObserver;
import vn.heomc.botchecker.probe.JvmObservationBoundClaimBuilder;
import vn.heomc.botchecker.probe.PaperJvmObservationClaimBridge;
import vn.heomc.botchecker.probe.PaperJvmObservationPort;

public final class PaperJvmObservationClaimBridgeGuardHarness {
  private static JvmArtifactObserver.Observation observation() {
    return new JvmArtifactObserver.Observation(
        JvmArtifactObserver.EVIDENCE_GRADE,
        false, false, false,
        List.of("standard-non-instrumented-anchor-classloader", "java-agent-absence-verified:false"),
        new JvmArtifactObserver.DeclaredIdentity(
            "candidate", "candidate", "plugins/Candidate.jar"),
        "fixture.Anchor",
        "${'5'.repeat(64)}",
        "${'1'.repeat(64)}",
        1024L,
        "${'6'.repeat(64)}",
        128L,
        "anchor-class-getResourceAsStream;loader-mediated;parent-delegation-possible;runtime-version-selection-unknown;may-differ-from-defined-bytecode;origin-not-proven",
        true, true, true,
        JvmArtifactObserver.InternalEntryConsistency.MATCH,
        false);
  }
  private static JvmObservationBoundClaimBuilder.Claims claims(
      long observedAtMs, String serverId, String bootId, String candidateSha) {
    return new JvmObservationBoundClaimBuilder.Claims(
        1,
        JvmObservationBoundClaimBuilder.DOMAIN,
        JvmObservationBoundClaimBuilder.PROFILE,
        "paper-audience", "paper-verifier", 7L,
        "${'a'.repeat(64)}",
        "${Buffer.alloc(32, 1).toString('base64url')}",
        "paper-run", "${'b'.repeat(64)}", "paper-binding", "${'c'.repeat(64)}",
        new JvmObservationBoundClaimBuilder.Provider(
            "server-probe", "paper-probe", "1.0.0", null),
        "paper-trust", "2026.08.30-1", "${'d'.repeat(64)}",
        10_000L, 15_000L, observedAtMs, serverId, bootId,
        List.of(
            new JvmObservationBoundClaimBuilder.Artifact(
                "probe", "probe", "plugins/Probe.jar", "${'4'.repeat(64)}"),
            new JvmObservationBoundClaimBuilder.Artifact(
                "candidate", "candidate", "plugins/Candidate.jar", candidateSha),
            new JvmObservationBoundClaimBuilder.Artifact(
                "paper", "paper", "server/paper.jar", "${'3'.repeat(64)}"),
            new JvmObservationBoundClaimBuilder.Artifact(
                "config", "config", "plugins/Candidate/config.yml", "${'2'.repeat(64)}")
        ));
  }
  public static void main(String[] args) {
    var result = new PaperJvmObservationPort.Result(
        10_050L, "paper-instance-a", "paper-boot-a", observation());
    var cases = List.of(
        claims(10_051L, "paper-instance-a", "paper-boot-a", "${'1'.repeat(64)}"),
        claims(10_050L, "paper-instance-b", "paper-boot-a", "${'1'.repeat(64)}"),
        claims(10_050L, "paper-instance-a", "paper-boot-b", "${'1'.repeat(64)}"),
        claims(10_050L, "paper-instance-a", "paper-boot-a", "${'9'.repeat(64)}")
    );
    for (int index = 0; index < cases.size(); index++) {
      if (index > 0) System.out.print("|");
      try {
        PaperJvmObservationClaimBridge.canonicalJsonUtf8V2(cases.get(index), result);
        System.out.print("UNEXPECTED");
      } catch (IllegalArgumentException error) {
        System.out.print(error.getMessage());
      }
    }
  }
}
`)
    run('javac', [
      '--release', '21', '-encoding', 'UTF-8', '-d', classes,
      ...javaSources, harness
    ], directory)
    assert.equal(
      run('java', ['-cp', classes, 'PaperJvmObservationClaimBridgeGuardHarness'], directory),
      [
        'Paper observation metadata does not match claims',
        'Paper observation metadata does not match claims',
        'Paper observation metadata does not match claims',
        'Observation does not exactly match candidate artifact'
      ].join('|')
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
