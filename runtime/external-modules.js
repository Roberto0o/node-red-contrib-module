'use strict';

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED_NAMES = new Set([
  'Buffer',
  'clearInterval',
  'clearTimeout',
  'console',
  'context',
  'emit',
  'env',
  'exports',
  'flow',
  'global',
  'module',
  'modules',
  'node',
  'require',
  'setInterval',
  'setTimeout',
]);

function normalizeExternalModules(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('External modules must be configured as a list');
  }

  const variableNames = new Set();
  return value.map(function (entry) {
    const variableName =
      entry && typeof entry.var === 'string' ? entry.var.trim() : '';
    const moduleName =
      entry && typeof entry.module === 'string' ? entry.module.trim() : '';

    if (!moduleName) {
      throw new Error('An imported module is missing its module name');
    }
    if (!IDENTIFIER_PATTERN.test(variableName)) {
      throw new Error(
        "Import variable '" + variableName + "' is not a valid JavaScript name",
      );
    }
    if (RESERVED_NAMES.has(variableName)) {
      throw new Error(
        "Import variable '" + variableName + "' is reserved by the Module node",
      );
    }
    if (variableNames.has(variableName)) {
      throw new Error(
        "Import variable '" + variableName + "' is configured more than once",
      );
    }
    variableNames.add(variableName);
    return { var: variableName, module: moduleName };
  });
}

async function loadExternalModules(RED, definitions) {
  if (!definitions.length) {
    return Object.create(null);
  }
  if (RED.settings && RED.settings.functionExternalModules === false) {
    throw new Error('External modules are disabled by the Node-RED settings');
  }
  if (typeof RED.import !== 'function') {
    throw new Error('This Node-RED runtime cannot import external modules');
  }

  const loaded = Object.create(null);
  await Promise.all(
    definitions.map(async function (definition) {
      try {
        const imported = await RED.import(definition.module);
        loaded[definition.var] =
          imported && imported.default !== undefined
            ? imported.default
            : imported;
      } catch (error) {
        throw new Error(
          "Could not import module '" +
            definition.module +
            "': " +
            (error && error.message ? error.message : String(error)),
        );
      }
    }),
  );
  return loaded;
}

function createConfiguredRequire(definitions, loadedModules) {
  const modulesByName = new Map();
  definitions.forEach(function (definition) {
    modulesByName.set(definition.module, loadedModules[definition.var]);
  });

  return function require(moduleName) {
    if (typeof moduleName !== 'string' || !modulesByName.has(moduleName)) {
      throw new Error(
        "Module '" +
          moduleName +
          "' is not configured. Add it to the Module node's Setup imports first.",
      );
    }
    return modulesByName.get(moduleName);
  };
}

module.exports = {
  createConfiguredRequire,
  IDENTIFIER_PATTERN,
  RESERVED_NAMES,
  loadExternalModules,
  normalizeExternalModules,
};
