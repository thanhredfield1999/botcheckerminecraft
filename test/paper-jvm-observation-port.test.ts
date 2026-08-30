import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseJvmArtifactObservationV1 } from '../src/jvm-artifact-observation.js'

const root = process.cwd()
const observerSource = path.join(root, 'java-src', 'vn', 'heomc', 'botchecker', 'probe', 'JvmArtifactObserver.java')
const portSource = path.join(root, 'java-src', 'vn', 'heomc', 'botchecker', 'probe', 'PaperJvmObservationPort.java')

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  }).trim()
}

test('Paper JVM observation port capture primary-thread context rồi observe off-thread', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-observation-port-'))
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

    const harness = path.join(directory, 'PaperJvmObservationPortHarness.java')
    writeFileSync(harness, `
import java.net.URLClassLoader;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicReference;
import vn.heomc.botchecker.probe.JvmArtifactObserver;
import vn.heomc.botchecker.probe.PaperJvmObservationPort;

public final class PaperJvmObservationPortHarness {
  public static void main(String[] args) throws Exception {
    var mainThread = Thread.currentThread();
    try (var loader = new URLClassLoader(
        new java.net.URL[] { Path.of(args[0]).toUri().toURL() },
        ClassLoader.getPlatformClassLoader())) {
      Class<?> anchor = Class.forName("fixture.Anchor", true, loader);
      var context = PaperJvmObservationPort.capture(
          () -> Thread.currentThread() == mainThread,
          anchor,
          new JvmArtifactObserver.DeclaredIdentity("candidate", "candidate", "plugins/Candidate.jar"),
          new JvmArtifactObserver.Limits(4 * 1024 * 1024, 1024 * 1024),
          "paper-instance-a",
          "paper-boot-a");
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
      System.out.println(result.get().observedAtMs());
      System.out.println(result.get().claimedServerInstanceId());
      System.out.println(result.get().claimedBootId());
      System.out.print(JvmArtifactObserver.canonicalJsonV1(result.get().observation()));
    }
  }
}
`)
    run('javac', [
      '--release', '21', '-encoding', 'UTF-8', '-d', harnessClasses,
      observerSource, portSource, harness
    ], directory)
    const output = run('java', ['-cp', harnessClasses, 'PaperJvmObservationPortHarness', fixtureJar], directory)
    const [observedAt, serverInstance, bootId, observationJson] = output.split(/\r?\n/, 4)

    assert.equal(observedAt, '10050')
    assert.equal(serverInstance, 'paper-instance-a')
    assert.equal(bootId, 'paper-boot-a')
    const observation = parseJvmArtifactObservationV1(JSON.parse(observationJson ?? ''))
    assert.equal(observation.declared.role, 'candidate')
    assert.equal(observation.declared.logicalId, 'candidate')
    assert.equal(observation.authoritative, false)
    assert.equal(observation.provesLoadedBytecode, false)
    assert.equal(observation.releaseEligible, false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Paper JVM observation port normalize supplier error và giữ one-shot boundary', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-observation-port-supplier-'))
  const classes = path.join(directory, 'classes')
  mkdirSync(classes)
  try {
    const harness = path.join(directory, 'PaperJvmObservationPortSupplierHarness.java')
    writeFileSync(harness, `
import vn.heomc.botchecker.probe.JvmArtifactObserver;
import vn.heomc.botchecker.probe.PaperJvmObservationPort;

public final class PaperJvmObservationPortSupplierHarness {
  public static void main(String[] args) throws Exception {
    try {
      PaperJvmObservationPort.capture(
          () -> { throw new IllegalStateException("secret/thread/path"); },
          PaperJvmObservationPortSupplierHarness.class,
          new JvmArtifactObserver.DeclaredIdentity(
              "candidate", "candidate", "plugins/Candidate.jar"),
          new JvmArtifactObserver.Limits(1024, 1024),
          "paper-instance-a", "paper-boot-a");
      System.out.print("UNEXPECTED_CAPTURE");
    } catch (IllegalStateException error) {
      System.out.print(error.getMessage());
    }
    System.out.print("|");
    var context = PaperJvmObservationPort.capture(
        () -> true,
        PaperJvmObservationPortSupplierHarness.class,
        new JvmArtifactObserver.DeclaredIdentity(
            "candidate", "candidate", "plugins/Candidate.jar"),
        new JvmArtifactObserver.Limits(1024, 1024),
        "paper-instance-a", "paper-boot-a");
    try {
      PaperJvmObservationPort.observe(
          context,
          () -> { throw new IllegalStateException("secret/worker/thread/path"); },
          () -> 10L);
      System.out.print("UNEXPECTED_THREAD");
    } catch (IllegalStateException error) {
      System.out.print(error.getMessage());
    }
    System.out.print("|");
    try {
      PaperJvmObservationPort.observe(
          context,
          () -> false,
          () -> { throw new IllegalStateException("secret/clock/path"); });
      System.out.print("UNEXPECTED_CLOCK");
    } catch (IllegalStateException error) {
      System.out.print(error.getMessage());
    }
    System.out.print("|");
    try {
      PaperJvmObservationPort.observe(context, () -> false, () -> 10L);
      System.out.print("UNEXPECTED_REUSE");
    } catch (IllegalStateException error) {
      System.out.print(error.getMessage());
    }
  }
}
`)
    run('javac', [
      '--release', '21', '-encoding', 'UTF-8', '-d', classes,
      observerSource, portSource, harness
    ], directory)
    assert.equal(
      run('java', ['-cp', classes, 'PaperJvmObservationPortSupplierHarness'], directory),
      [
        'PAPER_THREAD_CHECK_FAILED',
        'PAPER_THREAD_CHECK_FAILED',
        'PAPER_CLOCK_FAILED',
        'PAPER_OBSERVATION_CONTEXT_ALREADY_USED'
      ].join('|')
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Paper JVM observation port fail-closed thread, clock và identity trước artifact I/O', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-observation-port-guards-'))
  const classes = path.join(directory, 'classes')
  mkdirSync(classes)
  try {
    const harness = path.join(directory, 'PaperJvmObservationPortGuardHarness.java')
    writeFileSync(harness, `
import java.util.concurrent.atomic.AtomicInteger;
import vn.heomc.botchecker.probe.JvmArtifactObserver;
import vn.heomc.botchecker.probe.PaperJvmObservationPort;

public final class PaperJvmObservationPortGuardHarness {
  private static JvmArtifactObserver.DeclaredIdentity declared() {
    return new JvmArtifactObserver.DeclaredIdentity(
        "candidate", "candidate", "plugins/Candidate.jar");
  }
  private static JvmArtifactObserver.Limits limits() {
    return new JvmArtifactObserver.Limits(1024, 1024);
  }
  public static void main(String[] args) throws Exception {
    var clockCalls = new AtomicInteger();
    try {
      PaperJvmObservationPort.capture(
          () -> false, PaperJvmObservationPortGuardHarness.class, declared(), limits(),
          "paper-instance-a", "paper-boot-a");
      System.out.print("UNEXPECTED_CAPTURE");
    } catch (IllegalStateException error) {
      System.out.print(error.getMessage());
    }
    System.out.print("|");
    var context = PaperJvmObservationPort.capture(
        () -> true, PaperJvmObservationPortGuardHarness.class, declared(), limits(),
        "paper-instance-a", "paper-boot-a");
    try {
      PaperJvmObservationPort.observe(
          context, () -> true, () -> { clockCalls.incrementAndGet(); return 10L; });
      System.out.print("UNEXPECTED_OBSERVE");
    } catch (IllegalStateException error) {
      System.out.print(error.getMessage() + ":" + clockCalls.get());
    }
    System.out.print("|");
    try {
      PaperJvmObservationPort.capture(
          () -> true, PaperJvmObservationPortGuardHarness.class, declared(), limits(),
          "secret/path", "paper-boot-a");
      System.out.print("UNEXPECTED_ID");
    } catch (IllegalArgumentException error) {
      System.out.print(error.getMessage());
    }
    System.out.print("|");
    try {
      PaperJvmObservationPort.observe(context, () -> false, () -> -1L);
      System.out.print("UNEXPECTED_CLOCK");
    } catch (IllegalArgumentException error) {
      System.out.print(error.getMessage());
    }
    System.out.print("|");
    try {
      PaperJvmObservationPort.observe(context, () -> false, () -> 10L);
      System.out.print("UNEXPECTED_REUSE");
    } catch (IllegalStateException error) {
      System.out.print(error.getMessage());
    }
  }
}
`)
    run('javac', [
      '--release', '21', '-encoding', 'UTF-8', '-d', classes,
      observerSource, portSource, harness
    ], directory)
    assert.equal(
      run('java', ['-cp', classes, 'PaperJvmObservationPortGuardHarness'], directory),
      [
        'PAPER_PRIMARY_THREAD_REQUIRED',
        'PAPER_PRIMARY_THREAD_IO_REJECTED:0',
        'Invalid claimed server instance id',
        'Invalid observedAtMs',
        'PAPER_OBSERVATION_CONTEXT_ALREADY_USED'
      ].join('|')
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
