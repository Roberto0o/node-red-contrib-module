'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('package exposes the Module node and ships its runtime and editor assets', function () {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  );
  assert.equal(packageJson.name, 'node-red-contrib-module');
  assert.equal(packageJson['node-red'].nodes.module, 'module.js');
  assert.ok(packageJson.files.includes('runtime'));
  assert.ok(packageJson.files.includes('resources'));
  assert.ok(packageJson.files.includes('icons'));
});

test('editor registers a zero-port Function-category node and compiles', function () {
  const editorSource = fs.readFileSync(
    path.join(root, 'resources', 'module-editor.js'),
    'utf8',
  );
  const html = fs.readFileSync(path.join(root, 'module.html'), 'utf8');

  assert.match(editorSource, /category:\s*'function'/);
  assert.match(editorSource, /color:\s*'#fdd0a2'/);
  assert.match(editorSource, /inputs:\s*0/);
  assert.match(editorSource, /outputs:\s*0/);
  assert.match(editorSource, /RED\.editor\.createEditor/);
  assert.match(editorSource, /RED\.editor\.editJavaScript/);
  assert.match(html, /data-template-name="module"/);
  assert.doesNotThrow(function () {
    new Function(editorSource);
  });
});
