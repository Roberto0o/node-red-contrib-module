(function (root, factory) {
  'use strict';

  const scanner = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = scanner;
  } else {
    root.NodeRedModuleReferences = scanner;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  const GLOBAL_MODULES_PATTERN =
    "\\bglobal\\s*\\.\\s*get\\s*\\(\\s*[\"']modules[\"']\\s*\\)";

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function stripComments(source) {
    let result = '';
    let state = 'code';

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      const next = source[index + 1];

      if (state === 'line-comment') {
        if (character === '\n') {
          state = 'code';
          result += character;
        } else {
          result += ' ';
        }
        continue;
      }

      if (state === 'block-comment') {
        if (character === '*' && next === '/') {
          result += '  ';
          index += 1;
          state = 'code';
        } else {
          result += character === '\n' ? '\n' : ' ';
        }
        continue;
      }

      if (state === 'single-quote' || state === 'double-quote') {
        result += character;
        if (character === '\\') {
          if (next !== undefined) {
            result += next;
            index += 1;
          }
        } else if (
          (state === 'single-quote' && character === "'") ||
          (state === 'double-quote' && character === '"')
        ) {
          state = 'code';
        }
        continue;
      }

      if (state === 'template') {
        result += character;
        if (character === '\\') {
          if (next !== undefined) {
            result += next;
            index += 1;
          }
        } else if (character === '`') {
          state = 'code';
        }
        continue;
      }

      if (character === '/' && next === '/') {
        result += '  ';
        index += 1;
        state = 'line-comment';
      } else if (character === '/' && next === '*') {
        result += '  ';
        index += 1;
        state = 'block-comment';
      } else {
        result += character;
        if (character === "'") {
          state = 'single-quote';
        } else if (character === '"') {
          state = 'double-quote';
        } else if (character === '`') {
          state = 'template';
        }
      }
    }

    return result;
  }

  function propertyReferencePattern(rootPattern, moduleName) {
    const escapedName = escapeRegExp(moduleName);
    const bracket =
      rootPattern +
      "\\s*(?:\\?\\.)?\\s*\\[\\s*[\"']" +
      escapedName +
      "[\"']\\s*\\]";

    if (!IDENTIFIER_PATTERN.test(moduleName)) {
      return bracket;
    }

    const dot =
      rootPattern +
      '\\s*(?:\\.\\s*|\\?\\.\\s*)' +
      escapedName +
      '\\b';
    return '(?:' + dot + '|' + bracket + ')';
  }

  function propertyName(entry) {
    const withoutDefault = entry.split('=')[0].trim();
    const rawName = withoutDefault.split(':')[0].trim().replace(/^\.\.\./, '');
    if (
      (rawName.startsWith('"') && rawName.endsWith('"')) ||
      (rawName.startsWith("'") && rawName.endsWith("'"))
    ) {
      return rawName.slice(1, -1);
    }
    return rawName;
  }

  function destructuresModule(code, rootPattern, moduleName) {
    const expression = new RegExp(
      '\\{([^}]*)\\}\\s*=\\s*' + rootPattern,
      'g',
    );
    let match;

    while ((match = expression.exec(code))) {
      const entries = match[1].split(',');
      if (
        entries.some(function (entry) {
          return propertyName(entry) === moduleName;
        })
      ) {
        return true;
      }
    }

    return false;
  }

  function rootRefersTo(code, rootPattern, moduleName) {
    return (
      new RegExp(propertyReferencePattern(rootPattern, moduleName)).test(code) ||
      destructuresModule(code, rootPattern, moduleName)
    );
  }

  function sourceRefersTo(source, moduleName) {
    if (typeof source !== 'string' || source.length === 0) {
      return false;
    }

    const code = stripComments(source);
    if (rootRefersTo(code, GLOBAL_MODULES_PATTERN, moduleName)) {
      return true;
    }
    if (rootRefersTo(code, '\\bmodules\\b', moduleName)) {
      return true;
    }

    const aliasPattern = new RegExp(
      '\\b(?:const|let|var)\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s*=\\s*' +
        GLOBAL_MODULES_PATTERN,
      'g',
    );
    let aliasMatch;
    while ((aliasMatch = aliasPattern.exec(code))) {
      if (
        rootRefersTo(
          code,
          '\\b' + escapeRegExp(aliasMatch[1]) + '\\b',
          moduleName,
        )
      ) {
        return true;
      }
    }

    return false;
  }

  function findReferences(nodes, moduleName, ownerNodeId) {
    return (nodes || []).filter(function (node) {
      return (
        node &&
        node.id !== ownerNodeId &&
        node.d !== true &&
        (node.type === 'function' || node.type === 'module') &&
        sourceRefersTo(node.func, moduleName)
      );
    });
  }

  return {
    findReferences,
    sourceRefersTo,
    stripComments,
  };
});
