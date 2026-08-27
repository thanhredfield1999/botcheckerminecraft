import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const observer = path.join(process.cwd(), 'java-src', 'vn', 'heomc', 'botchecker', 'probe', 'JvmArtifactObserver.java')
function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true
  })
}

test('MRJAR fixture không phụ thuộc Unix cp', () => {
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  assert.doesNotMatch(source, /run\(['"]cp['"]/)
})

test('MRJAR runtime-versioned class vẫn chỉ tạo loader-mediated informational evidence', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-jvm-mrjar-'))
  const baseSource = path.join(directory, 'base-source', 'fixture')
  const v21Source = path.join(directory, 'v21-source', 'fixture')
  const baseClasses = path.join(directory, 'base-classes')
  const v21Classes = path.join(directory, 'v21-classes')
  const jarRoot = path.join(directory, 'jar-root')
  const harnessClasses = path.join(directory, 'harness')
  for (const item of [baseSource, v21Source, baseClasses, v21Classes, jarRoot, harnessClasses]) {
    mkdirSync(item, { recursive: true })
  }
  try {
    const baseJava = path.join(baseSource, 'Anchor.java')
    const v21Java = path.join(v21Source, 'Anchor.java')
    writeFileSync(baseJava, 'package fixture; public final class Anchor { public static int value() { return 20; } }\n')
    writeFileSync(v21Java, 'package fixture; public final class Anchor { public static int value() { return 21; } }\n')
    run('javac', ['--release', '17', '-d', baseClasses, baseJava], directory)
    run('javac', ['--release', '21', '-d', v21Classes, v21Java], directory)
    mkdirSync(path.join(jarRoot, 'fixture'), { recursive: true })
    mkdirSync(path.join(jarRoot, 'META-INF', 'versions', '21', 'fixture'), { recursive: true })
    copyFileSync(path.join(baseClasses, 'fixture', 'Anchor.class'), path.join(jarRoot, 'fixture', 'Anchor.class'))
    copyFileSync(path.join(v21Classes, 'fixture', 'Anchor.class'), path.join(jarRoot, 'META-INF', 'versions', '21', 'fixture', 'Anchor.class'))
    const manifest = path.join(directory, 'MANIFEST.MF')
    writeFileSync(manifest, 'Manifest-Version: 1.0\nMulti-Release: true\n\n')
    const mrJar = path.join(directory, 'candidate-mr.jar')
    run('jar', ['--create', '--file', mrJar, '--manifest', manifest, '-C', jarRoot, '.'], directory)

    const harnessSource = path.join(directory, 'MrJarHarness.java')
    writeFileSync(harnessSource, `
import fixture.Anchor;
import vn.heomc.botchecker.probe.JvmArtifactObserver;
public final class MrJarHarness {
  public static void main(String[] args) throws Exception {
    var observation = JvmArtifactObserver.observe(
      Anchor.class,
      new JvmArtifactObserver.DeclaredIdentity("candidate", "candidate", "plugins/Candidate.jar"),
      new JvmArtifactObserver.Limits(4 * 1024 * 1024, 1024 * 1024));
    System.out.println(Anchor.value());
    System.out.println(observation.internalEntryConsistency());
    System.out.println(observation.authoritative());
    System.out.println(observation.provesLoadedBytecode());
    System.out.println(observation.classResourceOrigin());
  }
}
`)
    run('javac', [
      '--release', '21', '-cp', mrJar, '-d', harnessClasses, observer, harnessSource
    ], directory)
    const separator = process.platform === 'win32' ? ';' : ':'
    const output = run('java', [
      '-cp', `${harnessClasses}${separator}${mrJar}`, 'MrJarHarness'
    ], directory).trim().split(/\r?\n/)
    assert.deepEqual(output.slice(0, 4), ['21', 'MISMATCH', 'false', 'false'])
    assert.match(output[4] ?? '', /runtime-version-selection-unknown/)
    assert.match(output[4] ?? '', /may-differ-from-defined-bytecode/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
