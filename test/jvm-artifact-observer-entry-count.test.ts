import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const observer = path.join(process.cwd(), 'java-src', 'vn', 'heomc', 'botchecker', 'probe', 'JvmArtifactObserver.java')
function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true
  })
}

test('JVM observer bound số entry khi scan JAR', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-jvm-entry-count-'))
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
    const classFile = path.join(classes, 'fixture', 'Anchor.class')
    const jarFile = path.join(directory, 'candidate.jar')
    const builderSource = path.join(directory, 'ManyEntriesBuilder.java')
    writeFileSync(builderSource, `
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
public final class ManyEntriesBuilder {
  public static void main(String[] args) throws Exception {
    try (var output = new ZipOutputStream(Files.newOutputStream(Path.of(args[0])))) {
      for (int index = 0; index < 4097; index++) {
        output.putNextEntry(new ZipEntry(String.format("empty/%04d", index)));
        output.closeEntry();
      }
      output.putNextEntry(new ZipEntry("fixture/Anchor.class"));
      output.write(Files.readAllBytes(Path.of(args[1])));
      output.closeEntry();
    }
  }
}
`)
    run('javac', ['--release', '21', '-d', harness, builderSource], directory)
    run('java', ['-cp', harness, 'ManyEntriesBuilder', jarFile, classFile], directory)

    const observerHarness = path.join(directory, 'EntryCountHarness.java')
    writeFileSync(observerHarness, `
import java.net.URLClassLoader;
import java.nio.file.Path;
import vn.heomc.botchecker.probe.JvmArtifactObserver;
public final class EntryCountHarness {
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
    run('javac', ['--release', '21', '-d', harness, observer, observerHarness], directory)
    assert.ok(readFileSync(jarFile).byteLength < 4 * 1024 * 1024)
    assert.equal(
      run('java', ['-cp', harness, 'EntryCountHarness', jarFile], directory).trim(),
      'JAR_ENTRY_COUNT_LIMIT'
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
