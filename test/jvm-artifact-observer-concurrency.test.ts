import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const observer = path.join(process.cwd(), 'java-src', 'vn', 'heomc', 'botchecker', 'probe', 'JvmArtifactObserver.java')
function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true
  })
}

test('JVM observer fail-fast khi vượt concurrency bound và release permit sau lỗi', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-jvm-concurrency-'))
  const source = path.join(directory, 'source')
  const classes = path.join(directory, 'classes')
  const harness = path.join(directory, 'harness')
  mkdirSync(path.join(source, 'fixture'), { recursive: true })
  mkdirSync(classes, { recursive: true })
  mkdirSync(harness, { recursive: true })
  try {
    const anchorSource = path.join(source, 'fixture', 'Anchor.java')
    writeFileSync(anchorSource, 'package fixture; public final class Anchor { public static int value() { return 21; } }\n')
    run('javac', ['--release', '21', '-d', classes, anchorSource], directory)
    const jarFile = path.join(directory, 'candidate.jar')
    run('jar', ['--create', '--file', jarFile, '-C', classes, '.'], directory)

    const harnessSource = path.join(directory, 'ConcurrencyHarness.java')
    writeFileSync(harnessSource, `
package vn.heomc.botchecker.probe;

import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;

public final class ConcurrencyHarness {
  private static final JvmArtifactObserver.DeclaredIdentity ID =
      new JvmArtifactObserver.DeclaredIdentity("candidate", "candidate", "plugins/Candidate.jar");
  private static final JvmArtifactObserver.Limits LIMITS =
      new JvmArtifactObserver.Limits(4 * 1024 * 1024, 1024 * 1024);

  public static void main(String[] args) throws Exception {
    URL url = Path.of(args[0]).toUri().toURL();
    try (URLClassLoader loader = new URLClassLoader(new URL[] { url }, ClassLoader.getPlatformClassLoader())) {
      Class<?> anchor = Class.forName("fixture.Anchor", true, loader);
      CountDownLatch entered = new CountDownLatch(2);
      CountDownLatch release = new CountDownLatch(1);
      List<Throwable> workerErrors = new ArrayList<>();
      Runnable worker = () -> {
        try {
          JvmArtifactObserver.observeForTesting(anchor, ID, LIMITS, ignored -> {
            entered.countDown();
            try { release.await(); } catch (InterruptedException error) {
              Thread.currentThread().interrupt();
              throw new java.io.IOException(error);
            }
          });
        } catch (Throwable error) {
          synchronized (workerErrors) { workerErrors.add(error); }
        }
      };
      Thread first = Thread.ofPlatform().start(worker);
      Thread second = Thread.ofPlatform().start(worker);
      entered.await();
      try {
        JvmArtifactObserver.observe(anchor, ID, LIMITS);
        System.out.println("UNEXPECTED_ACCEPT");
      } catch (JvmArtifactObserver.ObservationException error) {
        System.out.println(error.code());
      } finally {
        release.countDown();
      }
      first.join(); second.join();
      if (!workerErrors.isEmpty()) throw new AssertionError(workerErrors);
      System.out.println(JvmArtifactObserver.observe(anchor, ID, LIMITS).internalEntryConsistency());
      try {
        new JvmArtifactObserver.Limits(64L * 1024 * 1024, 64L * 1024 * 1024);
        System.out.println("UNEXPECTED_BUDGET_ACCEPT");
      } catch (IllegalArgumentException error) {
        System.out.println("TOTAL_BUDGET_REJECTED");
      }
    }
  }
}
`)
    run('javac', ['--release', '21', '-d', harness, observer, harnessSource], directory)
    assert.deepEqual(
      run('java', ['-cp', harness, 'vn.heomc.botchecker.probe.ConcurrencyHarness', jarFile], directory)
        .trim().split(/\r?\n/),
      ['OBSERVATION_CONCURRENCY_LIMIT', 'MATCH', 'TOTAL_BUDGET_REJECTED']
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
