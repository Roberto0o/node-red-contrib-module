'use strict';

const referenceScanner = require('../resources/reference-scanner');
const { evaluateModule } = require('./evaluator');
const { createLifecycle } = require('./lifecycle');
const { validateModuleName } = require('./module-name');
const { ModuleRegistry } = require('./registry');

const MAX_OUTPUTS = 500;

function createContextApi(context) {
  return {
    get: function () {
      return context.get.apply(context, arguments);
    },
    set: function () {
      return context.set.apply(context, arguments);
    },
    keys: function () {
      return context.keys.apply(context, arguments);
    },
  };
}

function createNodeApi(node, moduleName, lifecycle) {
  const api = {
    id: node.id,
    name: node.name,
    moduleName,
    onClose: lifecycle.onClose,
  };

  ['log', 'warn', 'error', 'debug', 'trace'].forEach(function (method) {
    if (typeof node[method] === 'function') {
      api[method] = node[method].bind(node);
    }
  });

  return api;
}

function hasUsefulExports(moduleExports) {
  if (typeof moduleExports === 'function') {
    return true;
  }
  if (moduleExports === null || typeof moduleExports !== 'object') {
    return moduleExports !== undefined;
  }
  return Reflect.ownKeys(moduleExports).length > 0;
}

function normalizeOutputCount(value) {
  const outputCount = value === undefined || value === '' ? 0 : Number(value);
  if (
    !Number.isInteger(outputCount) ||
    outputCount < 0 ||
    outputCount > MAX_OUTPUTS
  ) {
    throw new Error(
      'Outputs must be a whole number between 0 and ' + MAX_OUTPUTS,
    );
  }
  return outputCount;
}

function createEmit(node, moduleName, outputCount, isClosed) {
  return function emit(outputNumber, message) {
    if (isClosed()) {
      throw new Error("Module '" + moduleName + "' is no longer available");
    }

    const selectedOutput = Number(outputNumber);
    if (
      !Number.isInteger(selectedOutput) ||
      selectedOutput < 1 ||
      selectedOutput > outputCount
    ) {
      throw new Error(
        "Module '" +
          moduleName +
          "' tried to emit to output " +
          outputNumber +
          ', but only ' +
          outputCount +
          (outputCount === 1 ? ' output is' : ' outputs are') +
          ' configured.',
      );
    }

    const outputMessages = new Array(outputCount).fill(null);
    outputMessages[selectedOutput - 1] = message;
    node.send(outputMessages);
  };
}

function registerNodes(RED) {
  const registry = new ModuleRegistry();
  const instances = new Set();

  function findRuntimeReferences(instance) {
    const nodes = [];
    if (RED.nodes && typeof RED.nodes.eachNode === 'function') {
      RED.nodes.eachNode(function (node) {
        nodes.push(node);
      });
    }
    return referenceScanner.findReferences(
      nodes,
      instance.moduleName,
      instance.node.id,
    );
  }

  function statusText(moduleName, count) {
    return moduleName + ' (' + count + ')';
  }

  function refreshStatus(instance) {
    if (instance.closed) {
      return;
    }
    if (instance.state === 'error') {
      instance.node.status({
        fill: 'red',
        shape: 'ring',
        text: instance.moduleName || 'Module',
      });
      return;
    }
    if (instance.state !== 'ready') {
      instance.node.status({
        fill: 'yellow',
        shape: 'ring',
        text: instance.moduleName || 'Module',
      });
      return;
    }

    const referenceCount = findRuntimeReferences(instance).length;
    instance.node.status({
      fill: referenceCount > 0 ? 'green' : 'yellow',
      shape: referenceCount > 0 ? 'dot' : 'ring',
      text: statusText(instance.moduleName, referenceCount),
    });
  }

  function refreshAllStatuses() {
    instances.forEach(refreshStatus);
  }

  if (RED.events && typeof RED.events.on === 'function') {
    RED.events.on('flows:started', refreshAllStatuses);
  }

  function ModuleNode(config) {
    RED.nodes.createNode(this, config);

    const node = this;
    const ownerToken = Symbol('module-owner-' + node.id);
    const lifecycle = createLifecycle();
    const nodeContext = node.context();
    const context = createContextApi(nodeContext);
    const flow = createContextApi(nodeContext.flow);
    const global = createContextApi(nodeContext.global);
    Object.defineProperties(context, {
      flow: { value: flow, enumerable: true },
      global: { value: global, enumerable: true },
    });
    const env = {
      get: function (name) {
        return RED.util.getSetting(node, name);
      },
    };
    const source = typeof config.func === 'string' ? config.func : '';
    const instance = {
      node,
      moduleName: config.moduleName,
      state: 'loading',
      closed: false,
    };
    let moduleName = config.moduleName;
    let outputCount = 0;
    let registered = false;
    let initialization = Promise.resolve();

    instances.add(instance);
    node.func = source;
    node.moduleName = moduleName;

    function reportConfigurationError(error) {
      instance.state = 'error';
      instance.moduleName = moduleName;
      refreshStatus(instance);
      node.error(error.message);
    }

    node.on('close', function (removed, done) {
      if (typeof removed === 'function') {
        done = removed;
      }

      instance.closed = true;
      if (registered) {
        registry.markUnavailable(moduleName, ownerToken);
      }

      Promise.resolve(initialization)
        .catch(function () {
          // Initialization errors have already been reported on the node.
        })
        .then(function () {
          return lifecycle.close();
        })
        .then(function (errors) {
          errors.forEach(function (error) {
            node.error(
              "Module '" + moduleName + "' cleanup failed: " + error.message,
            );
          });
        })
        .finally(function () {
          if (registered) {
            registry.remove(moduleName, ownerToken);
          }
          instances.delete(instance);
          node.status({});
          refreshAllStatuses();
          if (typeof done === 'function') {
            done();
          }
        });
    });

    try {
      moduleName = validateModuleName(moduleName);
      outputCount = normalizeOutputCount(config.outputs);
      instance.moduleName = moduleName;
      node.moduleName = moduleName;
      node.outputs = outputCount;
      registry.registerLoading(moduleName, node.id, ownerToken);
      registered = true;
      nodeContext.global.set('modules', registry.modules);
      refreshStatus(instance);
    } catch (error) {
      reportConfigurationError(error);
      return;
    }

    const nodeApi = createNodeApi(node, moduleName, lifecycle);
    const emit = createEmit(
      node,
      moduleName,
      outputCount,
      function () {
        return instance.closed;
      },
    );
    initialization = evaluateModule({
      moduleName,
      source,
      node: nodeApi,
      context,
      flow,
      global,
      env,
      modules: registry.modules,
      emit,
      timers: lifecycle.timers,
    })
      .then(function (moduleExports) {
        if (instance.closed) {
          return;
        }

        registry.markReady(moduleName, ownerToken, moduleExports);
        instance.state = 'ready';
        refreshAllStatuses();

        if (!hasUsefulExports(moduleExports)) {
          node.warn("Module '" + moduleName + "' does not expose any exports");
        }
      })
      .catch(function (error) {
        if (instance.closed) {
          return;
        }

        registry.markError(moduleName, ownerToken, error);
        instance.state = 'error';
        refreshStatus(instance);
        node.error(
          "Module '" + moduleName + "' failed to load: " + error.message,
        );
      });
  }

  RED.nodes.registerType('module', ModuleNode);
}

module.exports = registerNodes;
module.exports.createEmit = createEmit;
module.exports.normalizeOutputCount = normalizeOutputCount;
