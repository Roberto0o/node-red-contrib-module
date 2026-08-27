'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const createIntellisense = require('../resources/module-intellisense');

function createHarness(nodes) {
  const models = new Map();
  const libraries = [];
  const events = new EventEmitter();
  const host = { type: 'monaco' };

  function uri(value) {
    return {
      toString: function () {
        return value;
      },
    };
  }

  const root = {
    RED: {
      editor: { codeEditor: { editor: host } },
      events,
      nodes: {
        eachNode: function (callback) {
          nodes.forEach(callback);
        },
        workspace: function () {},
        subflow: function () {},
      },
    },
    monaco: {
      Uri: { parse: uri },
      editor: {
        getModel: function (modelUri) {
          return models.get(modelUri.toString());
        },
        createModel: function (value, language, modelUri) {
          const model = {
            language,
            value,
            disposed: false,
            getValue: function () {
              return this.value;
            },
            setValue: function (updatedValue) {
              this.value = updatedValue;
            },
            isDisposed: function () {
              return this.disposed;
            },
            dispose: function () {
              this.disposed = true;
              models.delete(modelUri.toString());
            },
          };
          models.set(modelUri.toString(), model);
          return model;
        },
      },
      typescript: {
        javascriptDefaults: {
          addExtraLib: function (source, libraryUri) {
            const library = {
              source,
              uri: libraryUri,
              disposed: false,
              dispose: function () {
                this.disposed = true;
              },
            };
            libraries.push(library);
            return library;
          },
        },
      },
    },
    setTimeout,
    clearTimeout,
  };

  return {
    api: createIntellisense(root),
    models,
    libraries,
  };
}

test('mirrors Module sources and types the shared registry through imports', function () {
  const nodes = [
    {
      id: 'module-test',
      type: 'module',
      moduleName: 'test',
      func: 'const nested = { value: 10 }; module.exports = { nested };',
    },
    {
      id: 'module-logging',
      type: 'module',
      moduleName: 'logging',
      func: 'function info(value) {} module.exports = { info };',
    },
  ];
  const harness = createHarness(nodes);

  assert.equal(harness.api.sync(), true);
  assert.equal(harness.models.size, 2);
  assert.equal(
    harness.models.get('file:///node/module/module-test.js').getValue(),
    nodes[0].func,
  );

  const declarations = harness.libraries.at(-1).source;
  assert.match(declarations, /declare var module: \{ exports: any \};/);
  assert.match(declarations, /declare var exports: any;/);
  assert.match(declarations, /declare function require\(moduleName: string\): any;/);
  assert.match(
    declarations,
    /readonly test: typeof import\("\.\/module-test\.js"\)/,
  );
  assert.match(
    declarations,
    /readonly logging: typeof import\("\.\/module-logging\.js"\)/,
  );
  assert.doesNotMatch(declarations, /declare const modules/);
  assert.doesNotMatch(declarations, /namespace global/);

  nodes[0].func =
    'const nested = { value: 10, reset() {} }; module.exports = { nested };';
  harness.api.sync();
  assert.equal(
    harness.models.get('file:///node/module/module-test.js').getValue(),
    nodes[0].func,
  );

  nodes.splice(1, 1);
  harness.api.sync();
  assert.equal(harness.models.size, 1);
  assert.doesNotMatch(harness.libraries.at(-1).source, /logging/);
  harness.api.dispose();
});

test('omits invalid, duplicate, and disabled Module definitions', function () {
  const nodes = [
    { id: 'one', type: 'module', moduleName: 'same', func: '' },
    { id: 'two', type: 'module', moduleName: 'same', func: '' },
    { id: 'bad', type: 'module', moduleName: 'bad name', func: '' },
    { id: 'off', type: 'module', moduleName: 'off', func: '', d: true },
  ];
  const harness = createHarness(nodes);

  harness.api.sync();
  assert.equal(harness.models.size, 0);
  assert.doesNotMatch(harness.libraries.at(-1).source, /readonly/);
  harness.api.dispose();
});

test('adds a literal modules overload to Node-RED Function context types', function () {
  const harness = createHarness([]);
  const source =
    'declare class global {\n' +
    '    static get(name: string | string[]);\n' +
    '}';
  const augmented = harness.api.augmentFunctionTypes(source);

  assert.match(
    augmented,
    /static get\(name: "modules"\): NodeRedModuleRegistry;/,
  );
  assert.ok(
    augmented.indexOf('name: "modules"') < augmented.indexOf('name: string'),
  );
  harness.api.dispose();
});
