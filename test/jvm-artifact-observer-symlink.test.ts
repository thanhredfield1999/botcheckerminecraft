import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const observer = path.join(process.cwd(), 'java-src', 'vn', 'heomc', 'botchecker', 'probe', 'JvmArtifactObserver.java')
function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true
  })
}

test('JVM observer reject final-component CodeSource symlink', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-jvm-symlink-'))
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
    const jarFile = path.join(directory, 'candidate.jar')
    const linkFile = path.join(directory, 'candidate-link.jar')
    run('jar', ['--create', '--file', jarFile, '-C', classes, '.'], directory)
    try {
      symlinkSync(jarFile, linkFile, 'file')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') {
        t.skip(`Host không cho tạo symlink: ${code}`)
        return
      }
      throw error
    }
    const harnessSource = path.join(directory, 'SymlinkHarness.java')
    writeFileSync(harnessSource, `
import java.net.URLClassLoader;
import java.nio.file.Path;
import vn.heomc.botchecker.probe.JvmArtifactObserver;
public final class SymlinkHarness {
  public static void main(String[] args) throws Exception {
    try (var loader = new URLClassLoader(
      new java.net.URL[] { Path.of(args[0]).toUri().toURL() }, ClassLoader.getPlatformClassLoader())) {
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
      run('java', ['-cp', harness, 'SymlinkHarness', linkFile], directory).trim(),
      'CODESOURCE_SYMLINK_REJECTED'
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
