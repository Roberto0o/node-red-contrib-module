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
  assert.equal(packageJson.version, '1.0.1');
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
  const runtimeSource = fs.readFileSync(
    path.join(root, 'runtime', 'nodes.js'),
    'utf8',
  );
  const html = fs.readFileSync(path.join(root, 'module.html'), 'utf8');
  const icon = fs.readFileSync(path.join(root, 'icons', 'module.svg'), 'utf8');

  assert.match(editorSource, /category:\s*'function'/);
  assert.match(editorSource, /color:\s*'#ACE3D9'/);
  assert.match(editorSource, /inputs:\s*0/);
  assert.match(editorSource, /outputs:\s*0/);
  assert.match(editorSource, /outputs:\s*\{/);
  assert.match(editorSource, /RED\.editor\.createEditor/);
  assert.match(editorSource, /RED\.editor\.editJavaScript/);
  assert.match(editorSource, /javascriptDefaults\.addExtraLib/);
  assert.match(editorSource, /declare const modules: NodeRedModuleRegistry/);
  assert.match(editorSource, /declare function emit/);
  assert.match(editorSource, /declare function require/);
  assert.match(editorSource, /\/\* global emit, modules, require \*\//);
  assert.match(editorSource, /scrollOnAdd:\s*false/);
  assert.match(editorSource, /RED\.view\.reveal/);
  assert.match(runtimeSource, /dynamicModuleList:\s*'libs'/);
  assert.match(editorSource, /refreshModuleLibs/);
  assert.match(editorSource, /rewriteReferences/);
  assert.match(editorSource, /isActiveNode\(candidate\)/);
  assert.match(html, /data-template-name="module"/);
  assert.match(html, /id="module-tab-setup"/);
  assert.match(html, /id="module-tab-references"/);
  assert.match(html, /id="node-input-libs-container"/);
  assert.match(html, /id="node-input-updateReferences"/);
  assert.match(html, /id="node-input-outputs"/);
  assert.match(html, /placeholder="Module Name"/);
  assert.match(html, /reference-scanner\.js/);
  assert.match(html, /module-intellisense\.js/);
  assert.match(icon, /stroke="#fff"/);
  assert.doesNotThrow(function () {
    new Function(editorSource);
  });
});
