'use strict';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function evaluateModule(options) {
  const moduleObject = { exports: {} };
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
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
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
    options.timers.setTimeout,
    options.timers.clearTimeout,
    options.timers.setInterval,
    options.timers.clearInterval,
  );

  return moduleObject.exports;
}

module.exports = {
  evaluateModule,
};
