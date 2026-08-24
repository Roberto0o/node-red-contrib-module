'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { validateModuleName } = require('../runtime/module-name');

test('accepts supported global module names', function () {
  ['devices', 'logging', 'ripepilot.devices', 'room_utils', 'room-utils', 'v2'].forEach(
    function (name) {
      assert.equal(validateModuleName(name), name);
    },
  );
});

test('rejects blank, padded, and unsupported names', function () {
  [undefined, '', ' devices ', 'device manager!', '.devices'].forEach(
    function (name) {
      assert.throws(function () {
        validateModuleName(name);
      });
    },
  );
});
