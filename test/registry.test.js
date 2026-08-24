'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { DuplicateModuleError, ModuleRegistry } = require('../runtime/registry');

test('reports missing, loading, failed, and ready modules clearly', function () {
  const registry = new ModuleRegistry();
  const owner = Symbol('owner');

  assert.throws(function () {
    registry.useModule('devices');
  }, /Module 'devices' was not found/);

  registry.registerLoading('devices', 'node-a', owner);
  assert.throws(function () {
    registry.useModule('devices');
  }, /Module 'devices' is not ready/);

  registry.markError('devices', owner, new Error('Database unavailable'));
  assert.throws(function () {
    registry.useModule('devices');
  }, /Module 'devices' failed to load: Database unavailable/);

  const exportsObject = { get: function () {} };
  registry.markReady('devices', owner, exportsObject);
  assert.equal(registry.useModule('devices'), exportsObject);
});

test('rejects another owner and permits a replacement with the same node id', function () {
  const registry = new ModuleRegistry();
  const oldOwner = Symbol('old');
  const newOwner = Symbol('new');

  registry.registerLoading('devices', 'node-a', oldOwner);
  assert.throws(
    function () {
      registry.registerLoading('devices', 'node-b', Symbol('other'));
    },
    DuplicateModuleError,
  );

  registry.registerLoading('devices', 'node-a', newOwner);
  registry.markReady('devices', newOwner, { version: 2 });
  assert.equal(registry.remove('devices', oldOwner), false);
  assert.equal(registry.useModule('devices').version, 2);
});

test('moduleRef resolves current exports and preserves method receivers', function () {
  const registry = new ModuleRegistry();
  const firstOwner = Symbol('first');
  const secondOwner = Symbol('second');
  const logging = registry.moduleRef('logging');

  registry.registerLoading('logging', 'logger', firstOwner);
  registry.markReady('logging', firstOwner, {
    prefix: 'v1',
    version: function () {
      return this.prefix;
    },
  });
  assert.equal(logging.version(), 'v1');

  registry.registerLoading('logging', 'logger', secondOwner);
  registry.markReady('logging', secondOwner, {
    prefix: 'v2',
    version: function () {
      return this.prefix;
    },
  });
  assert.equal(logging.version(), 'v2');
});
