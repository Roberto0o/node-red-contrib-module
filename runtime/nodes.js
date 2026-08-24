'use strict';

const { evaluateModule } = require('./evaluator');
const { createLifecycle } = require('./lifecycle');
const { validateModuleName } = require('./module-name');
const { DuplicateModuleError, ModuleRegistry } = require('./registry');

function createContextApi(context) {
  const api = {
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

  return api;
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

function registerNodes(RED) {
  const registry = new ModuleRegistry();
  const useModule = registry.useModule;
  const moduleRef = registry.moduleRef;

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
    let moduleName = config.moduleName;
    let closed = false;
    let registered = false;
    let initialization = Promise.resolve();

    function reportConfigurationError(error) {
      const duplicate = error instanceof DuplicateModuleError;
      node.status({
        fill: 'red',
        shape: 'ring',
        text: duplicate ? 'duplicate module' : 'invalid module',
      });
      node.error(error.message);
    }

    node.on('close', function (removed, done) {
      if (typeof removed === 'function') {
        done = removed;
      }

      closed = true;
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
          node.status({});
          if (typeof done === 'function') {
            done();
          }
        });
    });

    try {
      moduleName = validateModuleName(moduleName);
      registry.registerLoading(moduleName, node.id, ownerToken);
      registered = true;
      nodeContext.global.set('useModule', useModule);
      node.status({ fill: 'yellow', shape: 'ring', text: 'loading' });
    } catch (error) {
      reportConfigurationError(error);
      return;
    }

    const nodeApi = createNodeApi(node, moduleName, lifecycle);
    initialization = evaluateModule({
      moduleName,
      source: typeof config.func === 'string' ? config.func : '',
      node: nodeApi,
      context,
      flow,
      global,
      env,
      useModule,
      moduleRef,
      timers: lifecycle.timers,
    })
      .then(function (moduleExports) {
        if (closed) {
          return;
        }

        registry.markReady(moduleName, ownerToken, moduleExports);
        node.status({ fill: 'green', shape: 'dot', text: moduleName });

        if (!hasUsefulExports(moduleExports)) {
          node.warn("Module '" + moduleName + "' does not expose any exports");
        }
      })
      .catch(function (error) {
        if (closed) {
          return;
        }

        registry.markError(moduleName, ownerToken, error);
        node.status({ fill: 'red', shape: 'ring', text: 'error' });
        node.error(
          "Module '" + moduleName + "' failed to load: " + error.message,
        );
      });
  }

  RED.nodes.registerType('module', ModuleNode);
}

module.exports = registerNodes;
