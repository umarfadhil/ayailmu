// Ownership regression for applyPrivateQaResources (plugins/withPrivateQa.js) on the real filesystem, frozen before the
// fix: the plugin must only ever write or remove its own two generated files inside the owned module tree, so a symlinked
// generated file or resource directory must be rejected rather than followed to a path outside that tree.
//
// UNIT MOCK DATA ONLY: each case builds a disposable fixture tree under fs.mkdtempSync(os.tmpdir()) and removes only that
// tree afterwards. Every byte is plain "unrelated fixture" or "not-a-certificate" text: no CA, certificate or key is
// generated or read, nothing is prebuilt, and the build is a fixed mock passed straight to the apply helper (io omitted,
// so the production node fs path runs), never through resolvePrivateQaBuild or withPrivateQa.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyPrivateQaResources } = require('../withPrivateQa');

const API = 'https://localhost:58444';
const AUTH = 'https://localhost:58445';
const MOCK_DER = Buffer.from('not-a-certificate');
const MOCK_SHA = crypto.createHash('sha256').update(MOCK_DER).digest('hex');
const MOCK_BUILD = Object.freeze({ apiOrigin: API, authOrigin: AUTH, caSha256: MOCK_SHA, der: MOCK_DER });
const UNRELATED = 'unrelated fixture';

const MODULE = path.join('modules', 'aya-private-qa-transport');
const DER_FILE = 'aya-private-qa-ca.der';
const BINDING_FILE = 'aya-private-qa-binding.json';

/**
 * Runs `run` against a fresh fixture: { projectRoot, moduleDir, outside }, where outside is a sibling of the app directory
 * (outside the owned tree). The realpath keeps the fixture free of symlinked ancestors such as macOS's /var. The whole
 * fixture, and nothing else, is removed afterwards whatever happens.
 */
function withFixture(run) {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), 'aya-private-qa-ownership-'));
  try {
    const root = fs.realpathSync(created);
    const projectRoot = path.join(root, 'app');
    const moduleDir = path.join(projectRoot, MODULE);
    const outside = path.join(root, 'outside');
    fs.mkdirSync(path.join(moduleDir, 'ios'), { recursive: true });
    fs.mkdirSync(path.join(moduleDir, 'android', 'src', 'main'), { recursive: true });
    fs.mkdirSync(outside);
    run({ projectRoot, moduleDir, outside });
  } finally {
    fs.rmSync(created, { recursive: true, force: true });
  }
}

/** Every entry of `dir` with its contents, so any creation, deletion or overwrite shows up. */
const snapshot = (dir) =>
  Object.fromEntries(fs.readdirSync(dir).sort().map((name) => [name, fs.readFileSync(path.join(dir, name), 'utf8')]));

function expectGenericFailure(run, outside) {
  let failure;
  try {
    run();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toMatch(/private QA/i);
  expect(failure.message).not.toContain(outside);
}

describe('applyPrivateQaResources: never writes or removes through a symlink (real filesystem, unit mock data)', () => {
  test('private build: a symlinked DER leaf is rejected and its outside target keeps its contents', () => {
    withFixture(({ projectRoot, moduleDir, outside }) => {
      const resources = path.join(moduleDir, 'ios', 'Resources');
      fs.mkdirSync(resources);
      fs.writeFileSync(path.join(outside, 'unrelated.txt'), UNRELATED);
      fs.symlinkSync(path.join(outside, 'unrelated.txt'), path.join(resources, DER_FILE), 'file');
      const before = snapshot(outside);

      expectGenericFailure(() => applyPrivateQaResources(projectRoot, MOCK_BUILD, 'ios'), outside);

      expect(snapshot(outside)).toStrictEqual(before);
      expect(fs.readFileSync(path.join(outside, 'unrelated.txt'), 'utf8')).toBe(UNRELATED);
    });
  });

  test('private build: a symlinked Resources directory is rejected before anything outside is created, removed or overwritten', () => {
    withFixture(({ projectRoot, moduleDir, outside }) => {
      fs.writeFileSync(path.join(outside, DER_FILE), UNRELATED);
      fs.writeFileSync(path.join(outside, BINDING_FILE), UNRELATED);
      fs.symlinkSync(outside, path.join(moduleDir, 'ios', 'Resources'), 'dir');
      const before = snapshot(outside);

      expectGenericFailure(() => applyPrivateQaResources(projectRoot, MOCK_BUILD, 'ios'), outside);

      expect(snapshot(outside)).toStrictEqual(before);
      expect(before).toStrictEqual({ [BINDING_FILE]: UNRELATED, [DER_FILE]: UNRELATED });
    });
  });

  test('ordinary build: a symlinked Android assets directory is rejected and the same-named outside files survive', () => {
    withFixture(({ projectRoot, moduleDir, outside }) => {
      fs.writeFileSync(path.join(outside, DER_FILE), UNRELATED);
      fs.writeFileSync(path.join(outside, BINDING_FILE), UNRELATED);
      fs.symlinkSync(outside, path.join(moduleDir, 'android', 'src', 'main', 'assets'), 'dir');
      const before = snapshot(outside);

      expectGenericFailure(() => applyPrivateQaResources(projectRoot, null, 'android'), outside);

      expect(snapshot(outside)).toStrictEqual(before);
      expect(before).toStrictEqual({ [BINDING_FILE]: UNRELATED, [DER_FILE]: UNRELATED });
    });
  });
});
