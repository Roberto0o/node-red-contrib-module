'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const scanner = require('../resources/reference-scanner');

test('detects direct, destructured, bracket, alias, and Module references', function () {
  const examples = [
    'const devices = global.get("modules").devices;',
    "const devices = global.get('modules')['devices'];",
    'const { devices, logging } = global.get("modules");',
    'const available = global.get("modules"); available.devices.get();',
    'const { devices: deviceApi } = modules;',
    'const devices = modules.devices;',
    'modules["devices"].get();',
  ];

  examples.forEach(function (source) {
    assert.equal(scanner.sourceRefersTo(source, 'devices'), true, source);
  });
});

test('supports names that require bracket access', function () {
  assert.equal(
    scanner.sourceRefersTo(
      'const devices = global.get("modules")["ripepilot.devices"];',
      'ripepilot.devices',
    ),
    true,
  );
  assert.equal(
    scanner.sourceRefersTo(
      'const devices = modules["ripepilot.devices"];',
      'ripepilot.devices',
    ),
    true,
  );
});

test('ignores comments and unrelated module names', function () {
  const source = [
    '// global.get("modules").devices;',
    '/* modules.devices.get(); */',
    'const logging = global.get("modules").logging;',
  ].join('\n');
  assert.equal(scanner.sourceRefersTo(source, 'devices'), false);
  assert.equal(scanner.sourceRefersTo(source, 'logging'), true);
});

test('returns each active referring node once', function () {
  const nodes = [
    {
      id: 'function-a',
      type: 'function',
      func: 'const d = global.get("modules").devices; d.get(); d.get();',
    },
    {
      id: 'module-a',
      type: 'module',
      func: 'const d = modules.devices;',
    },
    {
      id: 'disabled',
      type: 'function',
      d: true,
      func: 'global.get("modules").devices.get();',
    },
    {
      id: 'owner',
      type: 'module',
      func: 'modules.devices.get();',
    },
  ];

  assert.deepEqual(
    scanner
      .findReferences(nodes, 'devices', 'owner')
      .map(function (node) {
        return node.id;
      }),
    ['function-a', 'module-a'],
  );
});

test('rewrites only structural module references and preserves local names', function () {
  const source = [
    'const direct = global.get("modules").devices;',
    'const bracket = global.get("modules")["devices"];',
    'const available = global.get("modules"); available.devices.get();',
    'modules.devices.get();',
    'const { devices, devices: deviceApi } = modules;',
    'const text = "modules.devices and devices";',
    '// modules.devices must stay in this comment',
    'const template = `modules.devices`;',
    'const pattern = /modules\\.devices/;',
  ].join('\n');

  const updated = scanner.rewriteReferences(source, 'devices', 'hardware', {
    allowDirectModules: true,
  });

  assert.equal(updated.count, 6);
  assert.match(updated.source, /global\.get\("modules"\)\.hardware/);
  assert.match(updated.source, /global\.get\("modules"\)\["hardware"\]/);
  assert.match(updated.source, /available\.hardware\.get\(\)/);
  assert.match(updated.source, /modules\.hardware\.get\(\)/);
  assert.match(
    updated.source,
    /\{ hardware: devices, hardware: deviceApi \} = modules/,
  );
  assert.match(updated.source, /"modules\.devices and devices"/);
  assert.match(updated.source, /\/\/ modules\.devices must stay/);
  assert.match(updated.source, /`modules\.devices`/);
  assert.match(updated.source, /\/modules\\\.devices\//);
});

test('uses bracket notation when a renamed module is not an identifier', function () {
  const updated = scanner.rewriteReferences(
    'const { devices } = modules; modules?.devices.get();',
    'devices',
    'device-store',
    { allowDirectModules: true },
  );

  assert.equal(updated.count, 2);
  assert.equal(
    updated.source,
    'const { "device-store": devices } = modules; modules?.["device-store"].get();',
  );
});
