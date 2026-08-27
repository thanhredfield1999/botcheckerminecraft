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

test('JVM observer bound inflated bytes khi scan entry trước anchor', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-jvm-zip-scan-'))
  const source = path.join(directory, 'source', 'fixture')
  const classes = path.join(directory, 'classes')
  const harness = path.join(directory, 'harness')
  mkdirSync(source, { recursive: true })
  mkdirSync(classes, { recursive: true })
  mkdirSync(harness, { recursive: true })
  try {
    const anchorSource = path.join(source, 'Anchor.java')
    writeFileSync(anchorSource, 'package fixture; public final class Anchor { }\n')
    run('javac', ['--release', '21', '-d', classes, anchorSource], directory)
    const inflated = path.join(directory, 'a-inflated-before-anchor.bin')
    writeFileSync(inflated, Buffer.alloc(2 * 1024 * 1024, 65))
    const jarFile = path.join(directory, 'candidate.jar')
    run('jar', [
      '--create', '--file', jarFile,
      '-C', directory, 'a-inflated-before-anchor.bin',
      '-C', classes, 'fixture/Anchor.class'
    ], directory)

    const harnessSource = path.join(directory, 'ZipScanHarness.java')
    writeFileSync(harnessSource, `
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Path;
import vn.heomc.botchecker.probe.JvmArtifactObserver;
public final class ZipScanHarness {
  public static void main(String[] args) throws Exception {
    try (URLClassLoader loader = new URLClassLoader(
      new URL[] { Path.of(args[0]).toUri().toURL() }, ClassLoader.getPlatformClassLoader())) {
      Class<?> anchor = Class.forName("fixture.Anchor", true, loader);
      try {
        JvmArtifactObserver.observe(anchor,
          new JvmArtifactObserver.DeclaredIdentity("candidate", "candidate", "plugins/Candidate.jar"),
          new JvmArtifactObserver.Limits(4 * 1024 * 1024, 1024 * 1024));
        System.out.println("UNEXPECTED_ACCEPT");
      } catch (JvmArtifactObserver.ObservationException error) {
        System.out.println(error.code());
      }
    }
  }
}
`)
    run('javac', ['--release', '21', '-d', harness, observer, harnessSource], directory)
    assert.equal(
      run('java', ['-cp', harness, 'ZipScanHarness', jarFile], directory).trim(),
      'JAR_SCAN_TOO_LARGE'
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
