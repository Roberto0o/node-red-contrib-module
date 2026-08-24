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
    addRuntimeNode: harness.addRuntimeNode,
    events: harness.RED.events,
    globalContext: harness.globalContext,
  };
}

async function waitUntilReady(node, moduleName) {
  await waitFor(function () {
    return node.statuses.some(function (status) {
      return (
        (status.fill === 'green' || status.fill === 'yellow') &&
        status.text &&
        status.text.startsWith(moduleName + ' (')
      );
    });
  }, "Module '" + moduleName + "' did not become ready");
}

test('exports one shared modules proxy and keeps display and module names separate', async function () {
  const { NodeConstructor, globalContext } = setup();
  const node = new NodeConstructor({
    id: 'test-node',
    name: 'My Pretty Test Library',
    moduleName: 'test',
    outputs: 0,
    func: 'function hello() { return "hello"; } module.exports = { hello };',
  });
  const modules = globalContext.get('modules');

  assert.equal(typeof modules, 'object');
  assert.equal(globalContext.get('useModule'), undefined);
  assert.throws(function () {
    modules.test.hello();
  }, /not ready/);

  await waitUntilReady(node, 'test');
  const api = modules.test;
  assert.equal(api.hello(), 'hello');
  for (let index = 0; index < 10; index += 1) {
    assert.equal(modules.test, api);
  }
  assert.throws(function () {
    modules['My Pretty Test Library'].hello();
  }, /invalid/);
});

test('returns only the requested live module API', async function () {
  const { NodeConstructor, globalContext } = setup();
  const devices = new NodeConstructor({
    id: 'selective-devices',
    moduleName: 'devices',
    outputs: 0,
    func: 'module.exports = { deviceOnly: true };',
  });
  const logging = new NodeConstructor({
    id: 'selective-logging',
    moduleName: 'logging',
    outputs: 0,
    func: 'module.exports = { loggingOnly: true };',
  });
  await waitUntilReady(devices, 'devices');
  await waitUntilReady(logging, 'logging');

  const modules = globalContext.get('modules');
  assert.deepEqual(Object.keys(modules.devices), ['deviceOnly']);
  assert.equal(modules.devices.logging, undefined);
  assert.deepEqual(Object.keys(modules).sort(), ['devices', 'logging']);
});

test('supports asynchronous startup and marks initialization failures red', async function () {
  const { NodeConstructor, globalContext } = setup();
  const asyncNode = new NodeConstructor({
    id: 'async-node',
    moduleName: 'asyncModule',
    outputs: 0,
    func:
      'await new Promise((resolve) => setTimeout(resolve, 5)); ' +
      'module.exports = { ready: true };',
  });
  await waitUntilReady(asyncNode, 'asyncModule');
  assert.equal(globalContext.get('modules').asyncModule.ready, true);

  const failedNode = new NodeConstructor({
    id: 'failed-node',
    moduleName: 'failed',
    outputs: 0,
    func: 'throw new Error("Database unavailable");',
  });
  await waitFor(function () {
    return failedNode.statuses.some(function (status) {
      return status.fill === 'red' && status.text === 'failed';
    });
  });
  assert.throws(function () {
    return globalContext.get('modules').failed.value;
  }, /failed to load: Database unavailable/);
  assert.match(failedNode.errors[0], /Database unavailable/);
});

test('rejects duplicate module names without replacing the first module', async function () {
  const { NodeConstructor, globalContext } = setup();
  const first = new NodeConstructor({
    id: 'first',
    moduleName: 'devices',
    outputs: 0,
    func: 'module.exports = { owner: "first" };',
  });
  await waitUntilReady(first, 'devices');

  const duplicate = new NodeConstructor({
    id: 'second',
    moduleName: 'devices',
    outputs: 0,
    func: 'module.exports = { owner: "second" };',
  });
  assert.equal(duplicate.statuses.at(-1).fill, 'red');
  assert.equal(duplicate.statuses.at(-1).text, 'devices');
  assert.match(duplicate.errors[0], /already registered by node first/);
  assert.equal(globalContext.get('modules').devices.owner, 'first');
});

test('module dependencies handle deployment order and follow redeploys', async function () {
  const { NodeConstructor, globalContext } = setup();
  const devices = new NodeConstructor({
    id: 'devices-node',
    moduleName: 'devices',
    outputs: 0,
    func:
      'const logging = modules.logging; ' +
      'module.exports = { logVersion: () => logging.version() };',
  });
  await waitUntilReady(devices, 'devices');
  const devicesApi = globalContext.get('modules').devices;
  assert.throws(function () {
    devicesApi.logVersion();
  }, /Module 'logging' was not found/);

  const loggerV1 = new NodeConstructor({
    id: 'logger-node',
    moduleName: 'logging',
    outputs: 0,
    func: 'module.exports = { version: () => 1 };',
  });
  await waitUntilReady(loggerV1, 'logging');
  assert.equal(devicesApi.logVersion(), 1);

  const loggerV2 = new NodeConstructor({
    id: 'logger-node',
    moduleName: 'logging',
    outputs: 0,
    func: 'module.exports = { version: () => 2 };',
  });
  await waitUntilReady(loggerV2, 'logging');
  assert.equal(devicesApi.logVersion(), 2);

  await closeNode(loggerV1);
  assert.equal(devicesApi.logVersion(), 2);
});

test('return values and emitted messages are independent', async function () {
  const { NodeConstructor, globalContext } = setup();
  const node = new NodeConstructor({
    id: 'emit-node',
    moduleName: 'test',
    outputs: 2,
    func:
      'function sendOutput() { emit(1, { payload: "output" }); } ' +
      'function getValue() { return "caller"; } ' +
      'function doBoth() { emit(2, { payload: "changed" }); return { success: true }; } ' +
      'function doNeither() {} ' +
      'function invalid() { emit(3, { payload: "invalid" }); } ' +
      'module.exports = { sendOutput, getValue, doBoth, doNeither, invalid };',
  });
  await waitUntilReady(node, 'test');
  const api = globalContext.get('modules').test;

  assert.equal(api.getValue(), 'caller');
  assert.equal(node.sent.length, 0);

  assert.equal(api.sendOutput(), undefined);
  assert.deepEqual(node.sent[0], [{ payload: 'output' }, null]);

  assert.deepEqual(api.doBoth(), { success: true });
  assert.deepEqual(node.sent[1], [null, { payload: 'changed' }]);

  assert.equal(api.doNeither(), undefined);
  assert.equal(node.sent.length, 2);
  assert.throws(function () {
    api.invalid();
  }, /Module 'test' tried to emit to output 3, but only 2 outputs are configured/);
  assert.equal(node.sent.length, 2);
});

test('zero-output modules reject emit without affecting ordinary returns', async function () {
  const { NodeConstructor, globalContext } = setup();
  const node = new NodeConstructor({
    id: 'utility-node',
    moduleName: 'utils',
    outputs: 0,
    func:
      'module.exports = { value: () => 42, send: () => emit(1, { payload: 1 }) };',
  });
  await waitUntilReady(node, 'utils');
  const api = globalContext.get('modules').utils;
  assert.equal(api.value(), 42);
  assert.equal(node.sent.length, 0);
  assert.throws(function () {
    api.send();
  }, /only 0 outputs are configured/);
});

test('status reports reference counts and distinguishes used and unused modules', async function () {
  const { NodeConstructor, addRuntimeNode, events } = setup();
  const devices = new NodeConstructor({
    id: 'status-devices',
    moduleName: 'devices',
    outputs: 0,
    func: 'module.exports = { get: () => null };',
  });
  const logging = new NodeConstructor({
    id: 'status-logging',
    moduleName: 'logging',
    outputs: 0,
    func: 'module.exports = { info: () => {} };',
  });
  await waitUntilReady(devices, 'devices');
  await waitUntilReady(logging, 'logging');
  assert.deepEqual(logging.statuses.at(-1), {
    fill: 'yellow',
    shape: 'ring',
    text: 'logging (0)',
  });

  addRuntimeNode({
    id: 'function-user',
    type: 'function',
    z: 'flow-1',
    name: 'Use devices',
    func: 'const devices = global.get("modules").devices; devices.get();',
  });
  events.emit('flows:started');

  assert.deepEqual(devices.statuses.at(-1), {
    fill: 'green',
    shape: 'dot',
    text: 'devices (1)',
  });
  assert.equal(logging.statuses.at(-1).text, 'logging (0)');
});

test('runs async cleanup, clears timers, and removes exports on close', async function () {
  const { NodeConstructor, globalContext } = setup();
  const node = new NodeConstructor({
    id: 'lifecycle-node',
    moduleName: 'lifecycle',
    outputs: 0,
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
  const modules = globalContext.get('modules');
  const readTicks = modules.lifecycle.ticks;
  await new Promise(function (resolve) {
    setTimeout(resolve, 8);
  });

  await closeNode(node);
  const ticksAfterClose = readTicks();
  await new Promise(function (resolve) {
    setTimeout(resolve, 8);
  });

  assert.equal(globalContext.get('cleanupComplete'), true);
  assert.equal(readTicks(), ticksAfterClose);
  assert.throws(function () {
    return modules.lifecycle.ticks;
  }, /was not found/);
});

test('reports invalid names, outputs, and syntactically broken code', async function () {
  const { NodeConstructor, globalContext } = setup();
  const invalid = new NodeConstructor({
    id: 'invalid-name',
    moduleName: ' devices ',
    outputs: 0,
    func: 'module.exports = {};',
  });
  assert.equal(invalid.statuses.at(-1).fill, 'red');
  assert.equal(invalid.statuses.at(-1).text, ' devices ');

  const invalidOutputs = new NodeConstructor({
    id: 'invalid-outputs',
    moduleName: 'outputs',
    outputs: -1,
    func: 'module.exports = {};',
  });
  assert.equal(invalidOutputs.statuses.at(-1).fill, 'red');
  assert.match(invalidOutputs.errors[0], /Outputs must be a whole number/);

  const syntax = new NodeConstructor({
    id: 'syntax-node',
    moduleName: 'syntax',
    outputs: 0,
    func: 'module.exports = { broken: };',
  });
  await waitFor(function () {
    return syntax.statuses.some(function (status) {
      return status.fill === 'red' && status.text === 'syntax';
    });
  });
  assert.throws(function () {
    return globalContext.get('modules').syntax.value;
  }, /failed to load/);
});
