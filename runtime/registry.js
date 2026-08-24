'use strict';

const { validateModuleName } = require('./module-name');

class DuplicateModuleError extends Error {
  constructor(moduleName, nodeId) {
    super(
      "Module name '" +
        moduleName +
        "' is already registered by node " +
        nodeId,
    );
    this.name = 'DuplicateModuleError';
    this.code = 'MODULE_DUPLICATE';
    this.moduleName = moduleName;
    this.nodeId = nodeId;
  }
}

class ModuleRegistry {
  constructor() {
    this.records = new Map();
    this.useModule = this.useModule.bind(this);
    this.moduleRef = this.moduleRef.bind(this);
  }

  registerLoading(moduleName, nodeId, ownerToken) {
    const validName = validateModuleName(moduleName);
    const current = this.records.get(validName);

    if (current && current.nodeId !== nodeId) {
      throw new DuplicateModuleError(validName, current.nodeId);
    }

    const record = {
      nodeId,
      ownerToken,
      moduleName: validName,
      exports: undefined,
      state: 'loading',
      error: null,
    };

    this.records.set(validName, record);
    return record;
  }

  markReady(moduleName, ownerToken, moduleExports) {
    const record = this.getOwnedRecord(moduleName, ownerToken);
    if (!record) {
      return false;
    }

    record.exports = moduleExports;
    record.state = 'ready';
    record.error = null;
    return true;
  }

  markError(moduleName, ownerToken, error) {
    const record = this.getOwnedRecord(moduleName, ownerToken);
    if (!record) {
      return false;
    }

    record.exports = undefined;
    record.state = 'error';
    record.error = error instanceof Error ? error : new Error(String(error));
    return true;
  }

  markUnavailable(moduleName, ownerToken) {
    const record = this.getOwnedRecord(moduleName, ownerToken);
    if (!record) {
      return false;
    }

    record.exports = undefined;
    record.state = 'loading';
    record.error = null;
    return true;
  }

  remove(moduleName, ownerToken) {
    if (!this.getOwnedRecord(moduleName, ownerToken)) {
      return false;
    }

    return this.records.delete(moduleName);
  }

  getOwnedRecord(moduleName, ownerToken) {
    const record = this.records.get(moduleName);
    if (!record || record.ownerToken !== ownerToken) {
      return undefined;
    }
    return record;
  }

  useModule(moduleName) {
    const validName = validateModuleName(moduleName);
    const record = this.records.get(validName);

    if (!record) {
      throw new Error("Module '" + validName + "' was not found");
    }

    if (record.state === 'loading') {
      throw new Error("Module '" + validName + "' is not ready");
    }

    if (record.state === 'error') {
      throw new Error(
        "Module '" +
          validName +
          "' failed to load: " +
          record.error.message,
        { cause: record.error },
      );
    }

    return record.exports;
  }

  moduleRef(moduleName) {
    const validName = validateModuleName(moduleName);
    const registry = this;

    return new Proxy(
      {},
      {
        get: function (_target, property) {
          const moduleExports = registry.useModule(validName);
          const value = Reflect.get(Object(moduleExports), property, moduleExports);
          return typeof value === 'function'
            ? value.bind(moduleExports)
            : value;
        },
        set: function (_target, property, value) {
          const moduleExports = registry.useModule(validName);
          return Reflect.set(Object(moduleExports), property, value, moduleExports);
        },
        has: function (_target, property) {
          return property in Object(registry.useModule(validName));
        },
        ownKeys: function () {
          return Reflect.ownKeys(Object(registry.useModule(validName)));
        },
        getOwnPropertyDescriptor: function (_target, property) {
          const descriptor = Object.getOwnPropertyDescriptor(
            Object(registry.useModule(validName)),
            property,
          );

          if (!descriptor) {
            return undefined;
          }

          return Object.assign({}, descriptor, { configurable: true });
        },
      },
    );
  }
}

module.exports = {
  DuplicateModuleError,
  ModuleRegistry,
};
