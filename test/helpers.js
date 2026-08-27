'use strict';

const { EventEmitter } = require('node:events');

function createContextStore() {
  const values = new Map();
  return {
    get: function (key) {
      return values.get(key);
    },
    set: function (key, value) {
      values.set(key, value);
    },
    keys: function () {
      return Array.from(values.keys());
    },
  };
}

function createRed() {
  let NodeConstructor;
  let registrationOptions;
  const globalContext = createContextStore();
  const runtimeNodes = [];
  const events = new EventEmitter();
  const importedModules = new Map();

  const RED = {
    nodes: {
      createNode: function (node, config) {
        const emitter = new EventEmitter();
        const nodeContext = createContextStore();
        nodeContext.flow = createContextStore();
        nodeContext.global = globalContext;

        node.id = config.id;
        node.type = config.type || 'module';
        node.z = config.z || 'flow-1';
        node.name = config.name || '';
        node.on = emitter.on.bind(emitter);
        node.emit = emitter.emit.bind(emitter);
        node.context = function () {
          return nodeContext;
        };
        node.statuses = [];
        node.errors = [];
        node.warnings = [];
        node.logs = [];
        node.sent = [];
        node.status = function (status) {
          node.statuses.push(status);
        };
        node.error = function (message) {
          node.errors.push(String(message));
        };
        node.warn = function (message) {
          node.warnings.push(String(message));
        };
        node.log = function (message) {
          node.logs.push(String(message));
        };
        node.debug = node.log;
        node.trace = node.log;
        node.send = function (messages) {
          node.sent.push(messages);
        };
        runtimeNodes.push(node);
      },
      registerType: function (type, constructor, options) {
        if (type === 'module') {
          NodeConstructor = constructor;
          registrationOptions = options;
        }
      },
      eachNode: function (callback) {
        runtimeNodes.forEach(callback);
      },
    },
    events,
    settings: {
      functionExternalModules: true,
    },
    import: async function (moduleName) {
      if (!importedModules.has(moduleName)) {
        throw new Error("Module '" + moduleName + "' is not available");
      }
      const imported = importedModules.get(moduleName);
      if (imported instanceof Error) {
        throw imported;
      }
      return imported;
    },
    util: {
      getSetting: function (_node, name) {
        return process.env[name];
      },
    },
  };

  return {
    RED,
    globalContext,
    addRuntimeNode: function (node) {
      runtimeNodes.push(node);
      return node;
    },
    getConstructor: function () {
      return NodeConstructor;
    },
    getRegistrationOptions: function () {
      return registrationOptions;
    },
    setImportedModule: function (moduleName, value) {
      importedModules.set(moduleName, value);
    },
  };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(message || 'Timed out waiting for condition');
    }
    await new Promise(function (resolve) {
      setTimeout(resolve, 2);
    });
  }
}

function closeNode(node) {
  return new Promise(function (resolve) {
    node.emit('close', false, resolve);
  });
}

module.exports = {
  closeNode,
  createRed,
  waitFor,
};
