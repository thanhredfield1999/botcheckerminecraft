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

test('JAR entry consistency dùng chính whole-file snapshot, không reopen path', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-jvm-entry-race-'))
  const source = path.join(directory, 'source')
  const originalClasses = path.join(directory, 'original-classes')
  const replacementClasses = path.join(directory, 'replacement-classes')
  const harnessClasses = path.join(directory, 'harness')
  mkdirSync(path.join(source, 'fixture'), { recursive: true })
  mkdirSync(originalClasses, { recursive: true })
  mkdirSync(replacementClasses, { recursive: true })
  mkdirSync(harnessClasses, { recursive: true })
  try {
    const anchorSource = path.join(source, 'fixture', 'Anchor.java')
    writeFileSync(anchorSource, 'package fixture; public final class Anchor { public static int value() { return 21; } }\n')
    run('javac', ['--release', '21', '-d', originalClasses, anchorSource], directory)
    writeFileSync(anchorSource, 'package fixture; public final class Anchor { public static int value() { return 22; } }\n')
    run('javac', ['--release', '21', '-d', replacementClasses, anchorSource], directory)
    const originalJar = path.join(directory, 'candidate.jar')
    const replacementJar = path.join(directory, 'replacement.jar')
    run('jar', ['--create', '--file', originalJar, '-C', originalClasses, '.'], directory)
    run('jar', ['--create', '--file', replacementJar, '-C', replacementClasses, '.'], directory)

    const harnessSource = path.join(directory, 'SnapshotEntryHarness.java')
    writeFileSync(harnessSource, `
package vn.heomc.botchecker.probe;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.CodeSource;
import java.security.ProtectionDomain;
import java.security.cert.Certificate;
import java.util.jar.JarFile;

public final class SnapshotEntryHarness {
  private static final class Loader extends ClassLoader {
    private final byte[] bytes; private final URL source;
    Loader(byte[] bytes, URL source) { super(ClassLoader.getPlatformClassLoader()); this.bytes = bytes; this.source = source; }
    @Override protected Class<?> findClass(String name) throws ClassNotFoundException {
      if (!name.equals("fixture.Anchor")) throw new ClassNotFoundException(name);
      var domain = new ProtectionDomain(new CodeSource(source, (Certificate[]) null), null, this, null);
      return defineClass(name, bytes, 0, bytes.length, domain);
    }
    @Override public InputStream getResourceAsStream(String name) {
      return name.equals("fixture/Anchor.class") ? new ByteArrayInputStream(bytes) : super.getResourceAsStream(name);
    }
  }
  public static void main(String[] args) throws Exception {
    Path original = Path.of(args[0]); Path replacement = Path.of(args[1]); byte[] bytes;
    try (JarFile jar = new JarFile(original.toFile())) {
      bytes = jar.getInputStream(jar.getJarEntry("fixture/Anchor.class")).readAllBytes();
    }
    Class<?> anchor = Class.forName("fixture.Anchor", true, new Loader(bytes, original.toUri().toURL()));
    var result = JvmArtifactObserver.observeAfterSnapshotForTesting(
      anchor,
      new JvmArtifactObserver.DeclaredIdentity("candidate", "candidate", "plugins/Candidate.jar"),
      new JvmArtifactObserver.Limits(4 * 1024 * 1024, 1024 * 1024),
      ignored -> Files.move(replacement, original, StandardCopyOption.REPLACE_EXISTING));
    System.out.println(result.internalEntryConsistency());
  }
}
`)
    run('javac', ['--release', '21', '-d', harnessClasses, observer, harnessSource], directory)
    assert.equal(run('java', [
      '-cp', harnessClasses,
      'vn.heomc.botchecker.probe.SnapshotEntryHarness', originalJar, replacementJar
    ], directory).trim(), 'MATCH')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
