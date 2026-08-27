import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

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

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function parseLines(output: string): Record<string, string> {
  return Object.fromEntries(output.trim().split(/\r?\n/).map(line => {
    const separator = line.indexOf('=')
    assert.ok(separator > 0, `Invalid harness line: ${line}`)
    return [line.slice(0, separator), line.slice(separator + 1)]
  }))
}

test('JVM observer ghi clean local JAR dưới contract non-authoritative', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-jvm-observer-'))
  const anchorSourceRoot = path.join(directory, 'anchor-source')
  const anchorClasses = path.join(directory, 'anchor-classes')
  const harnessClasses = path.join(directory, 'harness-classes')
  const jarFile = path.join(directory, 'candidate.jar')
  mkdirSync(path.join(anchorSourceRoot, 'fixture'), { recursive: true })
  mkdirSync(anchorClasses, { recursive: true })
  mkdirSync(harnessClasses, { recursive: true })

  try {
    const anchorSource = path.join(anchorSourceRoot, 'fixture', 'Anchor.java')
    writeFileSync(anchorSource, 'package fixture; public final class Anchor { public static int value() { return 21; } }\n')
    run('javac', ['--release', '21', '-encoding', 'UTF-8', '-d', anchorClasses, anchorSource], directory)
    run('jar', ['--create', '--file', jarFile, '-C', anchorClasses, '.'], directory)

    const harnessSource = path.join(directory, 'ObserverHarness.java')
    writeFileSync(harnessSource, `
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Path;
import vn.heomc.botchecker.probe.JvmArtifactObserver;

public final class ObserverHarness {
    public static void main(String[] args) throws Exception {
        URL jar = Path.of(args[0]).toUri().toURL();
        try (URLClassLoader loader = new URLClassLoader(new URL[] { jar }, ClassLoader.getPlatformClassLoader())) {
            Class<?> anchor = Class.forName("fixture.Anchor", true, loader);
            var observation = JvmArtifactObserver.observe(
                anchor,
                new JvmArtifactObserver.DeclaredIdentity("candidate", "candidate", "plugins/Candidate.jar"),
                new JvmArtifactObserver.Limits(4 * 1024 * 1024, 1024 * 1024)
            );
            System.out.println("grade=" + observation.grade());
            System.out.println("authoritative=" + observation.authoritative());
            System.out.println("provesLoadedBytecode=" + observation.provesLoadedBytecode());
            System.out.println("releaseEligible=" + observation.releaseEligible());
            System.out.println("assumptions=" + String.join(",", observation.assumptions()));
            System.out.println("declaredRole=" + observation.declared().role());
            System.out.println("declaredLogicalId=" + observation.declared().logicalId());
            System.out.println("declaredLogicalPath=" + observation.declared().logicalPath());
            System.out.println("observedClassBinaryName=" + observation.observedClassBinaryName());
            System.out.println("codeSourceUriFingerprint=" + observation.codeSourceUriFingerprint());
            System.out.println("codeSourceFileSha256=" + observation.codeSourceFileSha256());
            System.out.println("codeSourceFileBytes=" + observation.codeSourceFileBytes());
            System.out.println("classResourceSha256=" + observation.classResourceSha256());
            System.out.println("classResourceBytes=" + observation.classResourceBytes());
            System.out.println("classResourceInformational=" + observation.classResourceInformational());
            System.out.println("sameLoaderMediated=" + observation.sameLoaderMediated());
            System.out.println("mayDifferFromDefinedBytecode=" + observation.mayDifferFromDefinedBytecode());
            System.out.println("internalEntryConsistency=" + observation.internalEntryConsistency());
            System.out.println("atomicSnapshot=" + observation.atomicSnapshot());
        }
    }
}
`)
    run('javac', [
      '--release', '21', '-encoding', 'UTF-8', '-d', harnessClasses,
      observerSource, harnessSource
    ], directory)
    const values = parseLines(run('java', ['-cp', harnessClasses, 'ObserverHarness', jarFile], directory))

    const anchorClass = readFileSync(path.join(anchorClasses, 'fixture', 'Anchor.class'))
    const canonicalUri = pathToFileURL(realpathSync(jarFile)).href
    assert.equal(values.grade, 'codesource-file-and-class-resource-observed')
    assert.equal(values.authoritative, 'false')
    assert.equal(values.provesLoadedBytecode, 'false')
    assert.equal(values.releaseEligible, 'false')
    assert.equal(values.assumptions, 'standard-non-instrumented-anchor-classloader,java-agent-absence-verified:false')
    assert.equal(values.declaredRole, 'candidate')
    assert.equal(values.declaredLogicalId, 'candidate')
    assert.equal(values.declaredLogicalPath, 'plugins/Candidate.jar')
    assert.equal(values.observedClassBinaryName, 'fixture.Anchor')
    assert.equal(values.codeSourceUriFingerprint, sha256(canonicalUri))
    assert.equal(values.codeSourceFileSha256, sha256(readFileSync(jarFile)))
    assert.equal(values.codeSourceFileBytes, String(readFileSync(jarFile).byteLength))
    assert.equal(values.classResourceSha256, sha256(anchorClass))
    assert.equal(values.classResourceBytes, String(anchorClass.byteLength))
    assert.equal(values.classResourceInformational, 'true')
    assert.equal(values.sameLoaderMediated, 'true')
    assert.equal(values.mayDifferFromDefinedBytecode, 'true')
    assert.equal(values.internalEntryConsistency, 'MATCH')
    assert.equal(values.atomicSnapshot, 'false')
    assert.doesNotMatch(JSON.stringify(values), new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
