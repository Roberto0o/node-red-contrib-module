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
  const globalContext = createContextStore();

  const RED = {
    nodes: {
      createNode: function (node, config) {
        const emitter = new EventEmitter();
        const nodeContext = createContextStore();
        nodeContext.flow = createContextStore();
        nodeContext.global = globalContext;

        node.id = config.id;
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
      },
      registerType: function (type, constructor) {
        if (type === 'module') {
          NodeConstructor = constructor;
        }
      },
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
    getConstructor: function () {
      return NodeConstructor;
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
