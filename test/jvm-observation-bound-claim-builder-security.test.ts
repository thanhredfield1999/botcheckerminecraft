import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const javaInteropAvailable = spawnSync('javac', ['--release', '21', '-version'], {
  encoding: 'utf8', windowsHide: true
}).status === 0

const securityHarness = `
import java.util.ArrayList;
import java.util.List;
import vn.heomc.botchecker.probe.JvmArtifactObserver;
import vn.heomc.botchecker.probe.JvmObservationBoundClaimBuilder;

public final class BuilderSecurityHarness {
  public static void main(String[] args) {
    String mode = args[0];
    var artifacts = new ArrayList<JvmObservationBoundClaimBuilder.Artifact>(List.of(
      new JvmObservationBoundClaimBuilder.Artifact(
        "candidate", "candidate", "plugins/Example.jar", "${'1'.repeat(64)}"),
      new JvmObservationBoundClaimBuilder.Artifact(
        "paper", "paper", "server/paper.jar", "${'3'.repeat(64)}"),
      new JvmObservationBoundClaimBuilder.Artifact(
        "probe", "probe", "plugins/Probe.jar", "${'4'.repeat(64)}"),
      new JvmObservationBoundClaimBuilder.Artifact(
        "config", "config", "plugins/Example/config.yml", "${'2'.repeat(64)}")
    ));
    if (mode.equals("duplicate")) {
      artifacts.add(new JvmObservationBoundClaimBuilder.Artifact(
        "config", "config", "plugins/Example/other.yml", "${'7'.repeat(64)}"));
    }
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
        "server-probe", "builder-probe", "1.0.0", null),
      "builder-trust",
      "2026.08.28-1",
      "${'d'.repeat(64)}",
      10000L,
      15000L,
      mode.equals("stale-time") ? 9999L : 10050L,
      "claimed-builder-server",
      "claimed-builder-boot",
      artifacts
    );
    var observation = new JvmArtifactObserver.Observation(
      JvmArtifactObserver.EVIDENCE_GRADE,
      false,
      false,
      false,
      List.of("standard-non-instrumented-anchor-classloader", "java-agent-absence-verified:false"),
      new JvmArtifactObserver.DeclaredIdentity(
        "candidate", "candidate", "plugins/Example.jar"),
      "com.example.Plugin",
      "${'5'.repeat(64)}",
      mode.equals("observation-mismatch") ? "${'9'.repeat(64)}" : "${'1'.repeat(64)}",
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
    JvmObservationBoundClaimBuilder.canonicalJsonUtf8V2(
      new JvmObservationBoundClaimBuilder.Input(claims, observation));
  }
}
`

test('Java production builder reject duplicate, stale time và candidate observation mismatch', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-java-builder-security-'))
  try {
    const classesPath = path.join(workspace, 'classes')
    const harnessPath = path.join(workspace, 'BuilderSecurityHarness.java')
    mkdirSync(classesPath)
    writeFileSync(harnessPath, securityHarness, 'utf8')
    execFileSync('javac', [
      '--release', '21', '-encoding', 'UTF-8', '-d', classesPath,
      path.resolve('java-src/vn/heomc/botchecker/probe/JvmArtifactObserver.java'),
      path.resolve('java-src/vn/heomc/botchecker/probe/JvmObservationBoundClaimBuilder.java'),
      harnessPath
    ], { cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe' })
    for (const mode of ['duplicate', 'stale-time', 'observation-mismatch']) {
      assert.throws(() => execFileSync('java', [
        '-cp', classesPath, 'BuilderSecurityHarness', mode
      ], { cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe' }))
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
