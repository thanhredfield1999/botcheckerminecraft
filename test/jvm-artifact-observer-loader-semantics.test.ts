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

function compileAnchor(directory: string, output: string, value: number): void {
  const sourceRoot = path.join(directory, `source-${value}`)
  mkdirSync(path.join(sourceRoot, 'fixture'), { recursive: true })
  mkdirSync(output, { recursive: true })
  const source = path.join(sourceRoot, 'fixture', 'Anchor.java')
  writeFileSync(source, `package fixture; public final class Anchor { public static int value() { return ${value}; } }\n`)
  run('javac', ['--release', '21', '-d', output, source], directory)
}

test('loader-mediated resource mismatch không được nâng thành loaded-bytecode proof', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-jvm-loader-'))
  const parentClasses = path.join(directory, 'parent-classes')
  const childClasses = path.join(directory, 'child-classes')
  const harnessClasses = path.join(directory, 'harness')
  mkdirSync(harnessClasses, { recursive: true })
  try {
    compileAnchor(directory, parentClasses, 20)
    compileAnchor(directory, childClasses, 21)
    const parentJar = path.join(directory, 'parent.jar')
    const childJar = path.join(directory, 'child.jar')
    run('jar', ['--create', '--file', parentJar, '-C', parentClasses, '.'], directory)
    run('jar', ['--create', '--file', childJar, '-C', childClasses, '.'], directory)

    const harnessSource = path.join(directory, 'LoaderHarness.java')
    writeFileSync(harnessSource, `
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Path;
import vn.heomc.botchecker.probe.JvmArtifactObserver;

public final class LoaderHarness {
  private static final class ChildFirstLoader extends URLClassLoader {
    ChildFirstLoader(URL child, ClassLoader parent) { super(new URL[] { child }, parent); }
    @Override protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
      if (!name.equals("fixture.Anchor")) return super.loadClass(name, resolve);
      synchronized (getClassLoadingLock(name)) {
        Class<?> loaded = findLoadedClass(name);
        if (loaded == null) loaded = findClass(name);
        if (resolve) resolveClass(loaded);
        return loaded;
      }
    }
  }
  public static void main(String[] args) throws Exception {
    try (URLClassLoader parent = new URLClassLoader(
           new URL[] { Path.of(args[0]).toUri().toURL() }, ClassLoader.getPlatformClassLoader());
         ChildFirstLoader child = new ChildFirstLoader(Path.of(args[1]).toUri().toURL(), parent)) {
      Class<?> anchor = Class.forName("fixture.Anchor", true, child);
      var observation = JvmArtifactObserver.observe(
        anchor,
        new JvmArtifactObserver.DeclaredIdentity("paper", "spoofed-label", "server/paper.jar"),
        new JvmArtifactObserver.Limits(4 * 1024 * 1024, 1024 * 1024));
      System.out.println(observation.internalEntryConsistency());
      System.out.println(observation.observedClassBinaryName());
      System.out.println(observation.declared().role());
      System.out.println(observation.authoritative());
      System.out.println(observation.provesLoadedBytecode());
      System.out.println(observation.classResourceOrigin());
    }
  }
}
`)
    run('javac', ['--release', '21', '-d', harnessClasses, observer, harnessSource], directory)
    const output = run('java', [
      '-cp', harnessClasses, 'LoaderHarness', parentJar, childJar
    ], directory).trim().split(/\r?\n/)
    assert.deepEqual(output.slice(0, 5), ['MISMATCH', 'fixture.Anchor', 'paper', 'false', 'false'])
    assert.match(output[5] ?? '', /loader-mediated/)
    assert.match(output[5] ?? '', /parent-delegation-possible/)
    assert.match(output[5] ?? '', /runtime-version-selection-unknown/)
    assert.match(output[5] ?? '', /may-differ-from-defined-bytecode/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
