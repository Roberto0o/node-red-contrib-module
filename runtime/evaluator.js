'use strict';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function evaluateModule(options) {
  const moduleObject = { exports: {} };
  const externalModules = options.externalModules || {};
  const externalNames = Object.keys(externalModules);
  const sourceUrl =
    'node-red-module-' + encodeURIComponent(options.moduleName) + '.js';
  const source =
    "'use strict';\n" + options.source + '\n//# sourceURL=' + sourceUrl;
  const execute = new AsyncFunction(
    'module',
    'exports',
    'node',
    'context',
    'flow',
    'global',
    'env',
    'modules',
    'emit',
    'require',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    ...externalNames,
    source,
  );

  await execute(
    moduleObject,
    moduleObject.exports,
    options.node,
    options.context,
    options.flow,
    options.global,
    options.env,
    options.modules,
    options.emit,
    options.require,
    options.timers.setTimeout,
    options.timers.clearTimeout,
    options.timers.setInterval,
    options.timers.clearInterval,
    ...externalNames.map(function (name) {
      return externalModules[name];
    }),
  );

  return moduleObject.exports;
}

module.exports = {
  evaluateModule,
};
