'use strict';

const MODULE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function validateModuleName(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Module name is required');
  }

  if (value !== value.trim()) {
    throw new Error('Module name must not contain leading or trailing whitespace');
  }

  if (!MODULE_NAME_PATTERN.test(value)) {
    throw new Error(
      "Module name '" +
        value +
        "' is invalid. Use letters, numbers, dots, underscores, or hyphens.",
    );
  }

  return value;
}

module.exports = {
  MODULE_NAME_PATTERN,
  validateModuleName,
};
