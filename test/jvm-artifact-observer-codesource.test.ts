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

test('JVM observer fail-closed khi CodeSource hoặc local-file location không đáng tin', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-jvm-codesource-'))
  const source = path.join(directory, 'source', 'fixture')
  const anchorClasses = path.join(directory, 'anchor')
  const harnessClasses = path.join(directory, 'harness')
  mkdirSync(source, { recursive: true })
  mkdirSync(anchorClasses, { recursive: true })
  mkdirSync(harnessClasses, { recursive: true })
  try {
    const anchorSource = path.join(source, 'Anchor.java')
    writeFileSync(anchorSource, 'package fixture; public final class Anchor { }\n')
    run('javac', ['--release', '21', '-d', anchorClasses, anchorSource], directory)
    const harnessSource = path.join(directory, 'CodeSourceHarness.java')
    writeFileSync(harnessSource, `
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.CodeSource;
import java.security.ProtectionDomain;
import java.security.cert.Certificate;
import vn.heomc.botchecker.probe.JvmArtifactObserver;

public final class CodeSourceHarness {
  private static final class Loader extends ClassLoader {
    private final byte[] bytes; private final String mode;
    Loader(byte[] bytes, String mode) { super(ClassLoader.getPlatformClassLoader()); this.bytes = bytes; this.mode = mode; }
    @Override protected Class<?> findClass(String name) throws ClassNotFoundException {
      if (!name.equals("fixture.Anchor")) throw new ClassNotFoundException(name);
      ProtectionDomain domain = switch (mode) {
        case "null-source" -> new ProtectionDomain(null, null, this, null);
        case "null-location" -> new ProtectionDomain(new CodeSource(null, (Certificate[]) null), null, this, null);
        case "http" -> {
          try { yield new ProtectionDomain(new CodeSource(new URL("http://example.invalid/candidate.jar"), (Certificate[]) null), null, this, null); }
          catch (Exception error) { throw new RuntimeException(error); }
        }
        case "missing" -> {
          try { yield new ProtectionDomain(new CodeSource(
            Path.of("missing-sensitive-server-path.jar").toAbsolutePath().toUri().toURL(),
            (Certificate[]) null), null, this, null); }
          catch (Exception error) { throw new RuntimeException(error); }
        }
        default -> throw new IllegalArgumentException(mode);
      };
      return defineClass(name, bytes, 0, bytes.length, domain);
    }
  }
  public static void main(String[] args) throws Exception {
    byte[] bytes = Files.readAllBytes(Path.of(args[1]));
    Class<?> anchor = Class.forName("fixture.Anchor", true, new Loader(bytes, args[0]));
    try {
      JvmArtifactObserver.observe(anchor,
        new JvmArtifactObserver.DeclaredIdentity("candidate", "candidate", "plugins/Candidate.jar"),
        new JvmArtifactObserver.Limits(1024 * 1024, 1024 * 1024));
      System.out.println("UNEXPECTED_ACCEPT");
    } catch (JvmArtifactObserver.ObservationException error) {
      System.out.println(args[0].equals("missing")
        ? error.code() + "|cause-null=" + (error.getCause() == null)
        : error.code());
    }
  }
}
`)
    run('javac', ['--release', '21', '-d', harnessClasses, observer, harnessSource], directory)
    const classFile = path.join(anchorClasses, 'fixture', 'Anchor.class')
    const invoke = (mode: string) => run(
      'java', ['-cp', harnessClasses, 'CodeSourceHarness', mode, classFile], directory).trim()
    assert.equal(invoke('null-source'), 'CODESOURCE_UNAVAILABLE')
    assert.equal(invoke('null-location'), 'CODESOURCE_NOT_LOCAL_FILE')
    assert.equal(invoke('http'), 'CODESOURCE_NOT_LOCAL_FILE')
    assert.equal(invoke('missing'), 'OBSERVATION_IO_REJECTED|cause-null=true')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
