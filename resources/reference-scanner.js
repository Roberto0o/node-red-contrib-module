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
  const REGEX_PREFIX_WORDS = new Set([
    'await',
    'case',
    'delete',
    'in',
    'instanceof',
    'new',
    'of',
    'return',
    'throw',
    'typeof',
    'void',
    'yield',
  ]);

  function isIdentifierStart(character) {
    return /[A-Za-z_$]/.test(character || '');
  }

  function isIdentifierPart(character) {
    return /[A-Za-z0-9_$]/.test(character || '');
  }

  function canStartRegex(previous) {
    if (!previous) {
      return true;
    }
    if (previous.type === 'identifier') {
      return REGEX_PREFIX_WORDS.has(previous.value);
    }
    return /^(?:\(|\[|\{|,|:|;|=|!|\?|\+|-|\*|%|&|\||\^|~|<|>)$/.test(
      previous.value,
    );
  }

  function tokenize(source) {
    const tokens = [];
    let index = 0;

    while (index < source.length) {
      const start = index;
      const character = source[index];
      const next = source[index + 1];

      if (/\s/.test(character)) {
        index += 1;
        continue;
      }
      if (character === '/' && next === '/') {
        index += 2;
        while (index < source.length && source[index] !== '\n') {
          index += 1;
        }
        continue;
      }
      if (character === '/' && next === '*') {
        index += 2;
        while (
          index < source.length &&
          !(source[index] === '*' && source[index + 1] === '/')
        ) {
          index += 1;
        }
        index = Math.min(source.length, index + 2);
        continue;
      }
      if (
        character === '/' &&
        canStartRegex(tokens.length ? tokens[tokens.length - 1] : null)
      ) {
        index += 1;
        let inCharacterClass = false;
        while (index < source.length) {
          const current = source[index];
          if (current === '\\') {
            index += 2;
            continue;
          }
          if (current === '[') {
            inCharacterClass = true;
          } else if (current === ']') {
            inCharacterClass = false;
          } else if (current === '/' && !inCharacterClass) {
            index += 1;
            while (/[A-Za-z]/.test(source[index] || '')) {
              index += 1;
            }
            break;
          }
          index += 1;
        }
        tokens.push({ type: 'regex', value: null, start, end: index });
        continue;
      }
      if (character === '"' || character === "'") {
        const quote = character;
        let value = '';
        let plain = true;
        index += 1;
        while (index < source.length) {
          const current = source[index];
          if (current === '\\') {
            plain = false;
            index += 2;
            continue;
          }
          if (current === quote) {
            index += 1;
            break;
          }
          value += current;
          index += 1;
        }
        tokens.push({
          type: 'string',
          value: plain ? value : null,
          start,
          end: index,
        });
        continue;
      }
      if (character === '`') {
        index += 1;
        while (index < source.length) {
          if (source[index] === '\\') {
            index += 2;
          } else if (source[index] === '`') {
            index += 1;
            break;
          } else {
            index += 1;
          }
        }
        tokens.push({ type: 'template', value: null, start, end: index });
        continue;
      }
      if (isIdentifierStart(character)) {
        index += 1;
        while (isIdentifierPart(source[index])) {
          index += 1;
        }
        tokens.push({
          type: 'identifier',
          value: source.slice(start, index),
          start,
          end: index,
        });
        continue;
      }
      if (character === '?' && next === '.') {
        index += 2;
        tokens.push({ type: 'punctuator', value: '?.', start, end: index });
        continue;
      }

      index += 1;
      tokens.push({
        type: 'punctuator',
        value: character,
        start,
        end: index,
      });
    }
    return tokens;
  }

  function globalModulesEnd(tokens, index) {
    if (
      tokens[index] &&
      tokens[index].type === 'identifier' &&
      tokens[index].value === 'global' &&
      tokens[index + 1] &&
      tokens[index + 1].value === '.' &&
      tokens[index + 2] &&
      tokens[index + 2].type === 'identifier' &&
      tokens[index + 2].value === 'get' &&
      tokens[index + 3] &&
      tokens[index + 3].value === '(' &&
      tokens[index + 4] &&
      tokens[index + 4].type === 'string' &&
      tokens[index + 4].value === 'modules' &&
      tokens[index + 5] &&
      tokens[index + 5].value === ')'
    ) {
      return index + 5;
    }
    return -1;
  }

  function rootEnd(tokens, index, aliases, allowDirectModules) {
    const globalEnd = globalModulesEnd(tokens, index);
    if (globalEnd !== -1) {
      return globalEnd;
    }
    if (
      tokens[index] &&
      tokens[index].type === 'identifier' &&
      (aliases.has(tokens[index].value) ||
        (allowDirectModules && tokens[index].value === 'modules'))
    ) {
      return index;
    }
    return -1;
  }

  function collectAliases(tokens) {
    const aliases = new Set();
    for (let index = 0; index < tokens.length - 3; index += 1) {
      if (
        tokens[index].type === 'identifier' &&
        /^(?:const|let|var)$/.test(tokens[index].value) &&
        tokens[index + 1].type === 'identifier' &&
        tokens[index + 2].value === '=' &&
        globalModulesEnd(tokens, index + 3) !== -1
      ) {
        aliases.add(tokens[index + 1].value);
      }
    }
    return aliases;
  }

  function propertyKey(name) {
    return IDENTIFIER_PATTERN.test(name) ? name : JSON.stringify(name);
  }

  function addPropertyEdit(tokens, rootIndex, moduleName, newName, edits) {
    const operator = tokens[rootIndex + 1];
    const property = tokens[rootIndex + 2];
    if (
      operator &&
      (operator.value === '.' || operator.value === '?.') &&
      property &&
      property.type === 'identifier' &&
      property.value === moduleName
    ) {
      edits.push({
        start: IDENTIFIER_PATTERN.test(newName) ? property.start : operator.start,
        end: property.end,
        replacement: IDENTIFIER_PATTERN.test(newName)
          ? newName
          : (operator.value === '?.' ? '?.' : '') +
            '[' +
            JSON.stringify(newName) +
            ']',
      });
      return;
    }

    let bracketIndex = rootIndex + 1;
    if (tokens[bracketIndex] && tokens[bracketIndex].value === '?.') {
      bracketIndex += 1;
    }
    if (
      tokens[bracketIndex] &&
      tokens[bracketIndex].value === '[' &&
      tokens[bracketIndex + 1] &&
      tokens[bracketIndex + 1].type === 'string' &&
      tokens[bracketIndex + 1].value === moduleName &&
      tokens[bracketIndex + 2] &&
      tokens[bracketIndex + 2].value === ']'
    ) {
      edits.push({
        start: tokens[bracketIndex + 1].start,
        end: tokens[bracketIndex + 1].end,
        replacement: JSON.stringify(newName),
      });
    }
  }

  function matchingBrace(tokens, startIndex) {
    let depth = 0;
    for (let index = startIndex; index < tokens.length; index += 1) {
      if (tokens[index].value === '{') {
        depth += 1;
      } else if (tokens[index].value === '}') {
        depth -= 1;
        if (depth === 0) {
          return index;
        }
      }
    }
    return -1;
  }

  function collectDestructuringEdits(
    tokens,
    moduleName,
    newName,
    aliases,
    allowDirectModules,
    edits,
  ) {
    for (let start = 0; start < tokens.length; start += 1) {
      if (tokens[start].value !== '{') {
        continue;
      }
      const end = matchingBrace(tokens, start);
      if (
        end === -1 ||
        !tokens[end + 1] ||
        tokens[end + 1].value !== '=' ||
        rootEnd(tokens, end + 2, aliases, allowDirectModules) === -1
      ) {
        continue;
      }

      let entryStart = start + 1;
      let nestedDepth = 0;
      for (let index = start + 1; index <= end; index += 1) {
        const token = tokens[index];
        const entryEnds =
          index === end || (nestedDepth === 0 && token.value === ',');
        if (entryEnds) {
          const first = tokens[entryStart];
          if (
            first &&
            (first.type === 'identifier' || first.type === 'string') &&
            first.value === moduleName
          ) {
            let hasAlias = false;
            for (let cursor = entryStart + 1; cursor < index; cursor += 1) {
              if (tokens[cursor].value === ':') {
                hasAlias = true;
                break;
              }
            }
            edits.push({
              start: first.start,
              end: first.end,
              replacement: hasAlias
                ? propertyKey(newName)
                : propertyKey(newName) + ': ' + moduleName,
            });
          }
          entryStart = index + 1;
          continue;
        }
        if (/^(?:\(|\[|\{)$/.test(token.value)) {
          nestedDepth += 1;
        } else if (/^(?:\)|\]|\})$/.test(token.value)) {
          nestedDepth -= 1;
        }
      }
      start = end;
    }
  }

  function referenceEdits(source, moduleName, newName, options) {
    if (
      typeof source !== 'string' ||
      typeof moduleName !== 'string' ||
      moduleName.length === 0
    ) {
      return [];
    }
    const settings = options || {};
    const allowDirectModules = settings.allowDirectModules !== false;
    const replacementName = newName === undefined ? moduleName : newName;
    const tokens = tokenize(source);
    const aliases = collectAliases(tokens);
    const edits = [];

    for (let index = 0; index < tokens.length; index += 1) {
      const end = rootEnd(tokens, index, aliases, allowDirectModules);
      if (end !== -1) {
        addPropertyEdit(tokens, end, moduleName, replacementName, edits);
        index = end;
      }
    }
    collectDestructuringEdits(
      tokens,
      moduleName,
      replacementName,
      aliases,
      allowDirectModules,
      edits,
    );

    const unique = new Map();
    edits.forEach(function (edit) {
      unique.set(edit.start + ':' + edit.end, edit);
    });
    return Array.from(unique.values()).sort(function (left, right) {
      return left.start - right.start;
    });
  }

  function sourceRefersTo(source, moduleName, options) {
    return referenceEdits(source, moduleName, moduleName, options).length > 0;
  }

  function rewriteReferences(source, oldName, newName, options) {
    const edits = referenceEdits(source, oldName, newName, options);
    let updatedSource = source;
    edits
      .slice()
      .sort(function (left, right) {
        return right.start - left.start;
      })
      .forEach(function (edit) {
        updatedSource =
          updatedSource.slice(0, edit.start) +
          edit.replacement +
          updatedSource.slice(edit.end);
      });
    return { source: updatedSource, count: edits.length };
  }

  function findReferences(nodes, moduleName, ownerNodeId, isActive) {
    return (nodes || []).filter(function (node) {
      const active = isActive ? isActive(node) : node && node.d !== true;
      return (
        node &&
        active &&
        node.id !== ownerNodeId &&
        (node.type === 'function' || node.type === 'module') &&
        sourceRefersTo(node.func, moduleName, {
          allowDirectModules: node.type === 'module',
        })
      );
    });
  }

  return {
    findReferences,
    referenceEdits,
    rewriteReferences,
    sourceRefersTo,
    tokenize,
  };
});
