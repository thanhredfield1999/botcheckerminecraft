import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const observer = path.join(root, 'java-src', 'vn', 'heomc', 'botchecker', 'probe', 'JvmArtifactObserver.java')

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true
  })
}

test('JVM observer fail-closed với directory, bounds và declared traversal', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-jvm-reject-'))
  const sourceRoot = path.join(directory, 'source')
  const classes = path.join(directory, 'classes')
  const harnessClasses = path.join(directory, 'harness')
  mkdirSync(path.join(sourceRoot, 'fixture'), { recursive: true })
  mkdirSync(classes, { recursive: true })
  mkdirSync(harnessClasses, { recursive: true })
  try {
    const anchorSource = path.join(sourceRoot, 'fixture', 'Anchor.java')
    writeFileSync(anchorSource, 'package fixture; public final class Anchor { public static int value() { return 21; } }\n')
    run('javac', ['--release', '21', '-encoding', 'UTF-8', '-d', classes, anchorSource], directory)
    const jarFile = path.join(directory, 'candidate.jar')
    run('jar', ['--create', '--file', jarFile, '-C', classes, '.'], directory)

    const harnessSource = path.join(directory, 'RejectHarness.java')
    writeFileSync(harnessSource, `
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Path;
import vn.heomc.botchecker.probe.JvmArtifactObserver;

public final class RejectHarness {
    private static Class<?> load(Path source) throws Exception {
        URLClassLoader loader = new URLClassLoader(
            new URL[] { source.toUri().toURL() }, ClassLoader.getPlatformClassLoader());
        return Class.forName("fixture.Anchor", true, loader);
    }
    private static void observe(Class<?> anchor, long fileLimit, long resourceLimit) {
        try {
            JvmArtifactObserver.observe(
                anchor,
                new JvmArtifactObserver.DeclaredIdentity("candidate", "candidate", "plugins/Candidate.jar"),
                new JvmArtifactObserver.Limits(fileLimit, resourceLimit));
            System.out.println("UNEXPECTED_ACCEPT");
        } catch (JvmArtifactObserver.ObservationException error) {
            System.out.println(error.code());
        }
    }
    public static void main(String[] args) throws Exception {
        switch (args[0]) {
            case "directory" -> observe(load(Path.of(args[1])), 4 * 1024 * 1024, 1024 * 1024);
            case "file-bound" -> observe(load(Path.of(args[1])), 1, 1024 * 1024);
            case "resource-bound" -> observe(load(Path.of(args[1])), 4 * 1024 * 1024, 1);
            case "traversal" -> {
                try {
                    new JvmArtifactObserver.DeclaredIdentity("candidate", "candidate", "plugins/../secret.jar");
                    System.out.println("UNEXPECTED_ACCEPT");
                } catch (IllegalArgumentException error) {
                    System.out.println("DECLARED_PATH_REJECTED");
                }
            }
            case "alias" -> {
                try {
                    new JvmArtifactObserver.DeclaredIdentity("candidate", "candidate", args[1]);
                    System.out.println("UNEXPECTED_ACCEPT");
                } catch (IllegalArgumentException error) {
                    System.out.println("DECLARED_PATH_REJECTED");
                }
            }
            default -> throw new IllegalArgumentException("unknown case");
        }
    }
}
`)
    run('javac', [
      '--release', '21', '-encoding', 'UTF-8', '-d', harnessClasses, observer, harnessSource
    ], directory)
    const invoke = (mode: string, source = jarFile) => run(
      'java', ['-cp', harnessClasses, 'RejectHarness', mode, source], directory).trim()

    assert.equal(invoke('directory', classes), 'CODESOURCE_NOT_REGULAR_FILE')
    assert.equal(invoke('file-bound'), 'CODESOURCE_FILE_TOO_LARGE')
    assert.equal(invoke('resource-bound'), 'CLASS_RESOURCE_TOO_LARGE')
    assert.equal(invoke('traversal'), 'DECLARED_PATH_REJECTED')
    assert.equal(invoke('alias', 'plugins/./Candidate.jar'), 'DECLARED_PATH_REJECTED')
    assert.equal(invoke('alias', 'plugins/Candidate.jar/'), 'DECLARED_PATH_REJECTED')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
