'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const registerNodes = require('../module');
const { closeNode, createRed, waitFor } = require('./helpers');

function setup() {
  const harness = createRed();
  registerNodes(harness.RED);
  return {
    NodeConstructor: harness.getConstructor(),
    globalContext: harness.globalContext,
  };
}

async function waitUntilReady(node, moduleName) {
  await waitFor(function () {
    return node.statuses.some(function (status) {
      return status.fill === 'green' && status.text === moduleName;
    });
  }, "Module '" + moduleName + "' did not become ready");
}

test('exports a shared API under moduleName, independently from display name', async function () {
  const { NodeConstructor, globalContext } = setup();
  const node = new NodeConstructor({
    id: 'test-node',
    name: 'My Pretty Test Library',
    moduleName: 'test',
    func: 'function hello() { return "hello"; } module.exports = { hello };',
  });
  const useModule = globalContext.get('useModule');

  assert.equal(typeof useModule, 'function');
  assert.throws(function () {
    useModule('test');
  }, /not ready/);

  await waitUntilReady(node, 'test');
  const api = useModule('test');
  assert.equal(api.hello(), 'hello');
  for (let index = 0; index < 10; index += 1) {
    assert.equal(useModule('test'), api);
  }
  assert.throws(function () {
    useModule('My Pretty Test Library');
  }, /invalid/);
});

test('returns only the requested module exports', async function () {
  const { NodeConstructor, globalContext } = setup();
  const devices = new NodeConstructor({
    id: 'selective-devices',
    moduleName: 'devices',
    func: 'module.exports = { deviceOnly: true };',
  });
  const logging = new NodeConstructor({
    id: 'selective-logging',
    moduleName: 'logging',
    func: 'module.exports = { loggingOnly: true };',
  });
  await waitUntilReady(devices, 'devices');
  await waitUntilReady(logging, 'logging');

  const devicesApi = globalContext.get('useModule')('devices');
  assert.deepEqual(Object.keys(devicesApi), ['deviceOnly']);
  assert.equal(devicesApi.logging, undefined);
});

test('supports asynchronous startup and marks initialization failures', async function () {
  const { NodeConstructor, globalContext } = setup();
  const asyncNode = new NodeConstructor({
    id: 'async-node',
    moduleName: 'asyncModule',
    func:
      'await new Promise((resolve) => setTimeout(resolve, 5)); ' +
      'module.exports = { ready: true };',
  });
  await waitUntilReady(asyncNode, 'asyncModule');
  assert.equal(globalContext.get('useModule')('asyncModule').ready, true);

  const failedNode = new NodeConstructor({
    id: 'failed-node',
    moduleName: 'failed',
    func: 'throw new Error("Database unavailable");',
  });
  await waitFor(function () {
    return failedNode.statuses.some(function (status) {
      return status.fill === 'red' && status.text === 'error';
    });
  });
  assert.throws(function () {
    globalContext.get('useModule')('failed');
  }, /failed to load: Database unavailable/);
  assert.match(failedNode.errors[0], /Database unavailable/);
});

test('rejects duplicate module names without replacing the first module', async function () {
  const { NodeConstructor, globalContext } = setup();
  const first = new NodeConstructor({
    id: 'first',
    moduleName: 'devices',
    func: 'module.exports = { owner: "first" };',
  });
  await waitUntilReady(first, 'devices');

  const duplicate = new NodeConstructor({
    id: 'second',
    moduleName: 'devices',
    func: 'module.exports = { owner: "second" };',
  });
  assert.equal(duplicate.statuses.at(-1).text, 'duplicate module');
  assert.match(duplicate.errors[0], /already registered by node first/);
  assert.equal(globalContext.get('useModule')('devices').owner, 'first');
});

test('moduleRef handles deployment order and follows dependency redeploys', async function () {
  const { NodeConstructor, globalContext } = setup();
  const devices = new NodeConstructor({
    id: 'devices-node',
    moduleName: 'devices',
    func:
      'const log = moduleRef("logging"); ' +
      'module.exports = { logVersion: () => log.version() };',
  });
  await waitUntilReady(devices, 'devices');
  const devicesApi = globalContext.get('useModule')('devices');
  assert.throws(function () {
    devicesApi.logVersion();
  }, /Module 'logging' was not found/);

  const loggerV1 = new NodeConstructor({
    id: 'logger-node',
    moduleName: 'logging',
    func: 'module.exports = { version: () => 1 };',
  });
  await waitUntilReady(loggerV1, 'logging');
  assert.equal(devicesApi.logVersion(), 1);

  const loggerV2 = new NodeConstructor({
    id: 'logger-node',
    moduleName: 'logging',
    func: 'module.exports = { version: () => 2 };',
  });
  await waitUntilReady(loggerV2, 'logging');
  assert.equal(devicesApi.logVersion(), 2);

  await closeNode(loggerV1);
  assert.equal(devicesApi.logVersion(), 2);
});

test('runs async cleanup, clears timers, and removes exports on close', async function () {
  const { NodeConstructor, globalContext } = setup();
  const node = new NodeConstructor({
    id: 'lifecycle-node',
    moduleName: 'lifecycle',
    func:
      'let ticks = 0; ' +
      'setInterval(() => { ticks += 1; }, 2); ' +
      'node.onClose(async () => { ' +
      '  await new Promise((resolve) => setTimeout(resolve, 3)); ' +
      '  global.set("cleanupComplete", true); ' +
      '}); ' +
      'module.exports = { ticks: () => ticks };',
  });
  await waitUntilReady(node, 'lifecycle');
  const api = globalContext.get('useModule')('lifecycle');
  await new Promise(function (resolve) {
    setTimeout(resolve, 8);
  });

  await closeNode(node);
  const ticksAfterClose = api.ticks();
  await new Promise(function (resolve) {
    setTimeout(resolve, 8);
  });

  assert.equal(globalContext.get('cleanupComplete'), true);
  assert.equal(api.ticks(), ticksAfterClose);
  assert.throws(function () {
    globalContext.get('useModule')('lifecycle');
  }, /was not found/);
});

test('reports invalid and syntactically broken module code', async function () {
  const { NodeConstructor, globalContext } = setup();
  const invalid = new NodeConstructor({
    id: 'invalid-name',
    moduleName: ' devices ',
    func: 'module.exports = {};',
  });
  assert.equal(invalid.statuses.at(-1).text, 'invalid module');

  const syntax = new NodeConstructor({
    id: 'syntax-node',
    moduleName: 'syntax',
    func: 'module.exports = { broken: };',
  });
  await waitFor(function () {
    return syntax.statuses.some(function (status) {
      return status.text === 'error';
    });
  });
  assert.throws(function () {
    globalContext.get('useModule')('syntax');
  }, /failed to load/);
});
