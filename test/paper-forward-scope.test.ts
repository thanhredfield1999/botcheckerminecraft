import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

// Inject only process/network boundaries; no real Java compile claimed here.
test('forward probe chỉ compile main sources và không bịa nguyên nhân failure', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bc-forward-layout-'))
  try {
    await mkdir(path.join(directory, 'scripts'))
    await copyFile('scripts/verify-paper-forward-compat.mjs', path.join(directory, 'scripts/probe.mjs'))
    for (const source of ['src/main/java/Adapter.java', 'keystore-companion/src/main/java/Companion.java', 'src/test/java/ExampleTest.java']) {
      const file = path.join(directory, 'paper-bukkit-adapter', source)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, '// source-list fixture, not compiled\n')
    }
    const script = `
      import child from 'node:child_process';
      import { readFileSync } from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      child.spawnSync = (_cmd, args) => {
        if (args[0] === '-version') return { status: 0 };
        console.log('fixture-sources=' + readFileSync(args.at(-1).slice(1), 'utf8'));
        return { status: 1, stderr: 'package org.example.missing does not exist' };
      };
      syncBuiltinESMExports();
      globalThis.fetch = async () => ({ ok: true,
        text: async () => '<metadata><release>4.0</release><version>26.2.build.121-stable</version></metadata>',
        arrayBuffer: async () => new ArrayBuffer(0) });
      await import('./scripts/probe.mjs');
    `
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: directory, encoding: 'utf8', timeout: 15_000, windowsHide: true,
      env: { ...process.env, REQUIRE_FORWARD_COMPAT: '1' }
    })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 1)
    assert.match(child.stdout, /Adapter.java/)
    assert.match(child.stdout, /Companion.java/)
    assert.doesNotMatch(child.stdout, /ExampleTest.java/)
    assert.doesNotMatch(child.stderr, /Paper đã đổi hoặc xoá/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('forward probe thiếu stable là NOT VERIFIED, không phải adapter defect', () => {
  const script = `
    import child from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    child.spawnSync = () => ({ status: 0 });
    syncBuiltinESMExports();
    globalThis.fetch = async () => ({ ok: true, text: async () => '<metadata></metadata>' });
    await import('./scripts/verify-paper-forward-compat.mjs');
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 15_000, windowsHide: true,
    env: { ...process.env, REQUIRE_FORWARD_COMPAT: '0', CI: 'false' }
  })
  assert.equal(child.error, undefined)
  assert.equal(child.status, 0)
  assert.match(child.stdout, /SKIPPED/)
  assert.match(child.stdout, /NOT verified/)
})
