import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('forward gate chọn stable mới nhất, không gọi prerelease là stable', () => {
  const script = `
    for (const key of Object.keys(process.env)) if (key.toLowerCase() === 'path') delete process.env[key];
    process.env.PATH = '';
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    childProcess.spawnSync = () => ({ status: 0 });
    syncBuiltinESMExports();
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('maven-metadata.xml')) return {
        ok: true, text: async () => '<metadata><release>26.3-pre-2.build.0-alpha</release><versions><version>26.2.build.121-stable</version><version>26.2.build.9-stable</version><version>26.3-pre-2.build.0-alpha</version></versions></metadata>'
      };
      console.log('fixture-jar-url=' + url);
      return { ok: false, status: 503 };
    };
    await import('./scripts/verify-paper-forward-compat.mjs');
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 15_000, windowsHide: true,
    env: { ...process.env, REQUIRE_FORWARD_COMPAT: '1' }
  })
  assert.equal(child.error, undefined)
  assert.equal(child.status, 1, 'fixture network failure must not pass required gate')
  assert.match(child.stdout, /fixture-jar-url=.*26\.2\.build\.121-stable/)
  assert.doesNotMatch(child.stdout, /fixture-jar-url=.*alpha/)
})

test('required forward gate không được xanh khi thiếu javac', async () => {
  const emptyPath = await mkdtemp(path.join(tmpdir(), 'bc-no-javac-'))
  try {
    const env = { ...process.env }
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key]
    env.PATH = emptyPath
    env.REQUIRE_FORWARD_COMPAT = '1'
    const child = spawnSync(process.execPath, ['scripts/verify-paper-forward-compat.mjs'], {
      env, encoding: 'utf8', timeout: 15_000, windowsHide: true
    })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 1)
    assert.match(child.stdout + child.stderr, /NOT verified/)
  } finally {
    await rm(emptyPath, { recursive: true, force: true })
  }
})
