import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const observerSource = path.join(root, 'java-src', 'vn', 'heomc', 'botchecker', 'probe', 'JvmArtifactObserver.java')

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  })
}

test('JVM observer phát hiện CodeSource path bị swap giữa metadata và open', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-jvm-race-'))
  const sourceRoot = path.join(directory, 'source')
  const anchorClasses = path.join(directory, 'anchor-classes')
  const harnessClasses = path.join(directory, 'harness-classes')
  mkdirSync(path.join(sourceRoot, 'fixture'), { recursive: true })
  mkdirSync(anchorClasses, { recursive: true })
  mkdirSync(harnessClasses, { recursive: true })
  try {
    const anchorSource = path.join(sourceRoot, 'fixture', 'Anchor.java')
    writeFileSync(anchorSource, 'package fixture; public final class Anchor { public static int value() { return 21; } }\n')
    run('javac', ['--release', '21', '-encoding', 'UTF-8', '-d', anchorClasses, anchorSource], directory)
    const originalJar = path.join(directory, 'candidate.jar')
    const replacementJar = path.join(directory, 'replacement.jar')
    run('jar', ['--create', '--file', originalJar, '-C', anchorClasses, '.'], directory)
    writeFileSync(path.join(directory, 'replacement-marker.txt'), 'replacement-has-different-size')
    run('jar', [
      '--create', '--file', replacementJar,
      '-C', anchorClasses, '.',
      '-C', directory, 'replacement-marker.txt'
    ], directory)

    const harnessSource = path.join(directory, 'RaceHarness.java')
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

public final class RaceHarness {
    private static final class MemoryLoader extends ClassLoader {
        private final byte[] classBytes;
        private final URL codeSource;
        MemoryLoader(byte[] classBytes, URL codeSource) {
            super(ClassLoader.getPlatformClassLoader());
            this.classBytes = classBytes;
            this.codeSource = codeSource;
        }
        @Override protected Class<?> findClass(String name) throws ClassNotFoundException {
            if (!name.equals("fixture.Anchor")) throw new ClassNotFoundException(name);
            ProtectionDomain domain = new ProtectionDomain(
                new CodeSource(codeSource, (Certificate[]) null), null, this, null);
            return defineClass(name, classBytes, 0, classBytes.length, domain);
        }
        @Override public InputStream getResourceAsStream(String name) {
            if (name.equals("fixture/Anchor.class")) return new ByteArrayInputStream(classBytes);
            return super.getResourceAsStream(name);
        }
    }

    public static void main(String[] args) throws Exception {
        Path original = Path.of(args[0]);
        Path replacement = Path.of(args[1]);
        byte[] classBytes;
        try (JarFile jar = new JarFile(original.toFile())) {
            classBytes = jar.getInputStream(jar.getJarEntry("fixture/Anchor.class")).readAllBytes();
        }
        Class<?> anchor = Class.forName(
            "fixture.Anchor", true, new MemoryLoader(classBytes, original.toUri().toURL()));
        try {
            JvmArtifactObserver.observeForTesting(
                anchor,
                new JvmArtifactObserver.DeclaredIdentity("candidate", "candidate", "plugins/Candidate.jar"),
                new JvmArtifactObserver.Limits(4 * 1024 * 1024, 1024 * 1024),
                ignored -> Files.move(replacement, original, StandardCopyOption.REPLACE_EXISTING)
            );
            System.out.println("UNEXPECTED_ACCEPT");
        } catch (JvmArtifactObserver.ObservationException error) {
            System.out.println(error.code());
        }
    }
}
`)
    run('javac', [
      '--release', '21', '-encoding', 'UTF-8', '-d', harnessClasses,
      observerSource, harnessSource
    ], directory)
    assert.equal(
      run('java', [
        '-cp', harnessClasses,
        'vn.heomc.botchecker.probe.RaceHarness',
        originalJar,
        replacementJar
      ], directory).trim(),
      'CODESOURCE_CHANGED_WHILE_READING'
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
