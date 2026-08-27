'use strict';

(function () {
  const MODULE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  const MAX_OUTPUTS = 500;
  const DEFAULT_CODE =
    'function hello() {\n' +
    '    return "hello";\n' +
    '}\n\n' +
    'module.exports = {\n' +
    '    hello\n' +
    '};';
  const ACE_MODULE_GLOBALS_HEADER = '/* global emit, modules, require */\n';
  const MODULE_EDITOR_GLOBAL_TYPES =
    'declare const modules: NodeRedModuleRegistry;\n' +
    'declare function emit(outputNumber: number, msg: any): void;\n' +
    'declare function require(moduleName: string): any;\n';
  const INVALID_IMPORT_NAMES = [
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
  ];
  const importAllowList = RED.utils.parseModuleList(
    RED.settings.get('externalModules.modules.allowList') || ['*'],
  );
  const importDenyList = RED.utils.parseModuleList(
    RED.settings.get('externalModules.modules.denyList') || [],
  );

  function isUniqueModuleName(node, value) {
    if (!isActiveNode(node)) {
      return true;
    }
    let unique = true;

    RED.nodes.eachNode(function (candidate) {
      if (
        candidate.type === 'module' &&
        candidate.id !== node.id &&
        isActiveNode(candidate) &&
        candidate.moduleName === value
      ) {
        unique = false;
      }
    });

    return unique;
  }

  function importAllowed(moduleName) {
    return RED.utils.checkModuleAllowed(
      moduleName,
      null,
      importAllowList,
      importDenyList,
    );
  }

  function validImportVariable(value) {
    return (
      /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value || '') &&
      INVALID_IMPORT_NAMES.indexOf(value) === -1
    );
  }

  function validateExternalModules(value) {
    if (!value) {
      return true;
    }
    if (value.length && RED.settings.functionExternalModules === false) {
      return 'External modules are disabled by the Node-RED settings.';
    }
    const usedVariables = Object.create(null);
    for (let index = 0; index < value.length; index += 1) {
      const entry = value[index];
      if (!entry || !entry.module || !importAllowed(entry.module)) {
        return 'The external module is not allowed by the Node-RED settings.';
      }
      if (!validImportVariable(entry.var) || usedVariables[entry.var]) {
        return 'Each import needs a unique, non-reserved JavaScript variable name.';
      }
      usedVariables[entry.var] = true;
    }
    return true;
  }

  function usedExternalModules() {
    const names = new Set();
    RED.nodes.eachNode(function (node) {
      (node.libs || []).forEach(function (entry) {
        if (entry && entry.module && importAllowed(entry.module)) {
          names.add(entry.module);
        }
      });
    });
    return Array.from(names).sort();
  }

  function importVariableFor(moduleName) {
    return String(moduleName || '')
      .trim()
      .replace(/^node:/, '')
      .replace(/^@/, '')
      .replace(/@.*$/, '')
      .replace(/[-_/.].?/g, function (value) {
        return value[1] ? value[1].toUpperCase() : '';
      });
  }

  function getExternalModules() {
    const result = [];
    const list = $('#node-input-libs-container');
    if (!list.length) {
      return result;
    }
    list.editableList('items').each(function () {
      const item = $(this);
      const moduleInput = item.find('.module-lib-name');
      let moduleName = moduleInput.typedInput('type');
      if (moduleName === '_custom_') {
        moduleName = moduleInput.val();
      }
      const variableName = item.find('.module-lib-variable').val();
      if (moduleName && variableName) {
        result.push({
          module: moduleName.trim(),
          var: variableName.trim(),
        });
      }
    });
    return result;
  }

  function prepareExternalModules(node) {
    const usedModules = usedExternalModules();
    const types = usedModules.map(function (moduleName) {
      return {
        icon: 'fa fa-cube',
        value: moduleName,
        label: moduleName,
        hasValue: false,
      };
    });
    types.push({
      value: '_custom_',
      label: 'Other',
      icon: 'red/images/typedInput/az.svg',
    });

    const list = $('#node-input-libs-container')
      .css('min-height', '300px')
      .css('min-width', '560px')
      .editableList({
        scrollOnAdd: false,
        header: $(
          '<div><div>Module name</div><div>Import as</div></div>',
        ),
        addItem: function (container, _index, option) {
          const row = $('<div>', { class: 'module-lib-entry' }).appendTo(
            container,
          );
          const moduleSpan = $('<span>').appendTo(row);
          const moduleInput = $('<input>', {
            class: 'module-lib-name',
            placeholder: 'Module',
            type: 'text',
          })
            .appendTo(moduleSpan)
            .typedInput({
              types,
              default:
                usedModules.indexOf(option.module) === -1
                  ? '_custom_'
                  : option.module,
            });
          if (usedModules.indexOf(option.module) === -1) {
            moduleInput.typedInput('value', option.module || '');
          }

          const variableSpan = $('<span>').appendTo(row);
          const variableInput = $('<input>', {
            class: 'module-lib-variable red-ui-font-code',
            placeholder: 'Variable',
            type: 'text',
          })
            .appendTo(variableSpan)
            .val(option.var || '');

          function validateRow(updateVariable) {
            let moduleName = moduleInput.typedInput('type');
            if (moduleName === '_custom_') {
              moduleName = moduleInput.val();
            }
            if (updateVariable) {
              variableInput.val(importVariableFor(moduleName));
            }
            moduleInput.toggleClass(
              'input-error',
              !moduleName || !importAllowed(moduleName),
            );
            variableInput.toggleClass(
              'input-error',
              !validImportVariable(variableInput.val().trim()),
            );
            if (
              node.editor &&
              node.editor.type === 'monaco' &&
              node.editor.nodered
            ) {
              node.editor.nodered.refreshModuleLibs(getExternalModules());
            }
          }

          moduleInput.on('change keyup paste', function () {
            validateRow(true);
          });
          variableInput.on('change keyup paste', function () {
            validateRow(false);
          });
          validateRow(false);
        },
        removable: true,
      });

    (node.libs || []).forEach(function (entry) {
      list.editableList('addItem', entry);
    });
  }

  function editorErrorCount(editor) {
    const annotations = editor.getSession().getAnnotations();
    return annotations.some(function (annotation) {
      return annotation.type === 'error';
    })
      ? 1
      : 0;
  }

  function destroyEditor(node) {
    if (node.moduleGlobalTypes) {
      node.moduleGlobalTypes.dispose();
      delete node.moduleGlobalTypes;
    }
    if (!node.editor) {
      return;
    }
    node.editor.destroy();
    delete node.editor;
  }

  function installModuleEditorGlobalTypes(node) {
    const monaco = globalThis.monaco;
    const javascriptDefaults =
      monaco && monaco.typescript && monaco.typescript.javascriptDefaults;

    if (
      javascriptDefaults &&
      typeof javascriptDefaults.addExtraLib === 'function'
    ) {
      node.moduleGlobalTypes = javascriptDefaults.addExtraLib(
        MODULE_EDITOR_GLOBAL_TYPES,
        'file:///node-red-contrib-module/module-editor-globals.d.ts',
      );
    }
  }

  function expandedEditorValue(editor, value) {
    if (editor.type !== 'ace') {
      return { value, addedHeader: false };
    }
    return {
      value: ACE_MODULE_GLOBALS_HEADER + value,
      addedHeader: true,
    };
  }

  function removeExpandedEditorHeader(value, addedHeader) {
    if (addedHeader && value.indexOf(ACE_MODULE_GLOBALS_HEADER) === 0) {
      return value.slice(ACE_MODULE_GLOBALS_HEADER.length);
    }
    return value;
  }

  function workspaceFor(node) {
    if (!node || !node.z) {
      return undefined;
    }
    return RED.nodes.workspace(node.z) || RED.nodes.subflow(node.z);
  }

  function flowLabel(node) {
    const workspace = workspaceFor(node);
    if (!workspace) {
      return node.z || 'Global';
    }
    return workspace.label || workspace.name || workspace.id;
  }

  function isActiveNode(node) {
    const workspace = workspaceFor(node);
    return node.d !== true && (!workspace || workspace.disabled !== true);
  }

  function allNodes() {
    const nodes = [];
    RED.nodes.eachNode(function (node) {
      nodes.push(node);
    });
    return nodes;
  }

  function activeReferences(owner, moduleName) {
    const scanner = globalThis.NodeRedModuleReferences;
    return scanner
      ? scanner.findReferences(allNodes(), moduleName, owner.id, isActiveNode)
      : [];
  }

  function updateRenameReferenceOption(owner) {
    const originalName = owner._moduleOriginalName;
    const nextName = $('#node-input-moduleName').val();
    const references =
      originalName &&
      nextName !== originalName &&
      isActiveNode(owner)
        ? activeReferences(owner, originalName)
        : [];
    const key = originalName + '\u0000' + nextName;
    const checkbox = $('#node-input-updateReferences');
    if (checkbox.data('rename-key') !== key) {
      checkbox.prop('checked', false).data('rename-key', key);
    }
    $('#module-rename-references-row').toggle(references.length > 0);
    $('#module-rename-references-label').text(
      'Update ' +
        references.length +
        (references.length === 1 ? ' active reference' : ' active references') +
        " from '" +
        originalName +
        "' to '" +
        nextName +
        "'",
    );
  }

  function updateReferencesForRename(owner, oldName, newName) {
    const scanner = globalThis.NodeRedModuleReferences;
    if (
      !scanner ||
      oldName === newName ||
      !$('#node-input-updateReferences').prop('checked')
    ) {
      return 0;
    }

    const historyEvents = [];
    let changedNodes = 0;
    const wasDirty = RED.nodes.dirty();
    activeReferences(owner, oldName).forEach(function (reference) {
      const updated = scanner.rewriteReferences(
        reference.func,
        oldName,
        newName,
        { allowDirectModules: reference.type === 'module' },
      );
      if (!updated.count || updated.source === reference.func) {
        return;
      }
      historyEvents.push({
        t: 'edit',
        node: reference,
        changes: { func: reference.func },
        dirty: reference.dirty,
        changed: reference.changed,
      });
      reference.func = updated.source;
      reference.changed = true;
      reference.dirty = true;
      changedNodes += 1;
      RED.editor.validateNode(reference);
      RED.events.emit('nodes:change', reference);
    });

    if (historyEvents.length) {
      RED.history.push({
        t: 'multi',
        events: historyEvents,
        dirty: wasDirty,
      });
      RED.nodes.dirty(true);
      RED.view.redraw();
      RED.notify(
        'Updated references in ' +
          changedNodes +
          (changedNodes === 1 ? ' node.' : ' nodes.'),
        'success',
      );
    }
    return changedNodes;
  }

  function nodeLabel(node) {
    if (node.name) {
      return node.name;
    }
    if (node.type === 'module') {
      return node.moduleName ? 'Module: ' + node.moduleName : 'Module';
    }
    return 'Function';
  }

  function navigateToReference(owner, targetId) {
    const target = RED.nodes.node(targetId);
    if (!target) {
      RED.notify('The referenced node is no longer available.', 'warning');
      return;
    }

    $('#node-dialog-ok').trigger('click');
    setTimeout(function () {
      const editStack =
        RED.editor && typeof RED.editor.getEditStack === 'function'
          ? RED.editor.getEditStack()
          : [];
      const stillEditingOwner = editStack.some(function (entry) {
        return entry && entry.id === owner.id;
      });

      if (stillEditingOwner) {
        RED.notify(
          'Fix the Module validation errors before navigating.',
          'warning',
        );
        return;
      }

      if (RED.nodes.node(targetId)) {
        RED.view.reveal(targetId);
      }
    }, 350);
  }

  function createReferenceRow(owner, reference) {
    const row = $('<tr>', {
      class: 'module-reference-row',
      tabindex: 0,
      title: 'Open ' + nodeLabel(reference),
    });
    const isModule = reference.type === 'module';
    const typeCell = $('<td>', { class: 'module-reference-type' }).appendTo(row);
    $('<i>', { class: 'fa ' + (isModule ? 'fa-cube' : 'fa-code') }).appendTo(
      typeCell,
    );
    $('<span>').text(isModule ? 'Module' : 'Function').appendTo(typeCell);
    $('<td>').text(flowLabel(reference)).appendTo(row);
    $('<td>').text(nodeLabel(reference)).appendTo(row);

    function navigate(event) {
      event.preventDefault();
      event.stopPropagation();
      navigateToReference(owner, reference.id);
    }

    row.on('click', navigate);
    row.on('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        navigate(event);
      }
    });
    return row;
  }

  function renderReferences(owner) {
    const moduleName = $('#node-input-moduleName').val() || owner.moduleName;
    const references = activeReferences(owner, moduleName);
    const list = $('#module-reference-list').empty();

    references
      .sort(function (left, right) {
        return (
          flowLabel(left).localeCompare(flowLabel(right)) ||
          nodeLabel(left).localeCompare(nodeLabel(right))
        );
      })
      .forEach(function (reference) {
        createReferenceRow(owner, reference).appendTo(list);
      });

    $('#module-reference-count').text(
      references.length + (references.length === 1 ? ' reference' : ' references'),
    );
    $('#module-reference-empty').toggle(references.length === 0);
    $('.module-reference-table').toggle(references.length > 0);
  }

  let validationTimer = null;
  function scheduleModuleNameValidation() {
    if (validationTimer) {
      return;
    }
    validationTimer = setTimeout(function () {
      validationTimer = null;
      RED.nodes.eachNode(function (node) {
        if (node.type === 'module') {
          RED.editor.validateNode(node);
        }
      });
      RED.view.redraw();
    }, 20);
  }

  ['nodes:add', 'nodes:remove', 'nodes:change', 'flows:loaded'].forEach(
    function (eventName) {
      RED.events.on(eventName, scheduleModuleNameValidation);
    },
  );

  RED.nodes.registerType('module', {
    category: 'function',
    color: '#ACE3D9',
    defaults: {
      name: { value: '' },
      moduleName: {
        value: '',
        required: true,
        validate: function (value) {
          return (
            typeof value === 'string' &&
            value === value.trim() &&
            MODULE_NAME_PATTERN.test(value) &&
            isUniqueModuleName(this, value)
          );
        },
      },
      outputs: {
        value: 0,
        required: true,
        validate: function (value) {
          const outputCount = Number(value);
          return (
            Number.isInteger(outputCount) &&
            outputCount >= 0 &&
            outputCount <= MAX_OUTPUTS
          );
        },
      },
      func: { value: DEFAULT_CODE, required: true },
      libs: {
        value: [],
        validate: validateExternalModules,
      },
      noerr: {
        value: 0,
        required: true,
        validate: function (value) {
          return Number(value) === 0;
        },
      },
    },
    inputs: 0,
    outputs: 0,
    icon: 'module.svg',
    paletteLabel: 'module',
    label: function () {
      return this.name || (this.moduleName ? 'Module: ' + this.moduleName : 'Module');
    },
    labelStyle: function () {
      return this.name ? 'node_label_italic' : '';
    },
    oneditprepare: function () {
      const node = this;
      this._moduleOriginalName = this.moduleName;
      const tabs = RED.tabs.create({
        id: 'module-tabs',
        onchange: function (tab) {
          $('#module-tabs-content').children().hide();
          $('#' + tab.id).show();
          if (tab.id === 'module-tab-references') {
            renderReferences(node);
          }
          if (
            tab.id === 'module-tab-body' &&
            node.editor &&
            node.editor.type === 'monaco' &&
            node.editor.nodered
          ) {
            node.editor.nodered.refreshModuleLibs(getExternalModules());
          }
          RED.tray.resize();
          if (tab.id === 'module-tab-body' && node.editor) {
            node.editor.resize();
            node.editor.focus();
          }
        },
      });

      tabs.addTab({
        id: 'module-tab-setup',
        iconClass: 'fa fa-cog',
        label: 'Setup',
      });
      tabs.addTab({
        id: 'module-tab-references',
        iconClass: 'fa fa-list',
        label: 'References',
      });
      tabs.addTab({
        id: 'module-tab-body',
        iconClass: 'fa fa-code',
        label: 'Module',
      });

      $('#node-input-outputs').spinner({
        min: 0,
        max: MAX_OUTPUTS,
        change: function () {
          let value = Number(this.value);
          if (!Number.isInteger(value)) {
            value = 0;
          }
          value = Math.min(MAX_OUTPUTS, Math.max(0, value));
          $(this).spinner('value', value);
        },
      });
      prepareExternalModules(this);
      $('#node-input-moduleName').on('input.moduleRename', function () {
        updateRenameReferenceOption(node);
      });
      updateRenameReferenceOption(this);

      const stateId = this.id + '/module-editor';
      this.editor = RED.editor.createEditor({
        id: 'node-input-module-editor',
        node: {
          id: this.id,
          type: this.type,
          z: this.z,
        },
        mode: 'ace/mode/nrjavascript',
        value: $('#node-input-func').val() || DEFAULT_CODE,
        stateId,
        focus: true,
        globals: {
          module: true,
          exports: true,
          node: true,
          context: true,
          flow: true,
          global: true,
          env: true,
          modules: true,
          emit: true,
          require: true,
          console: true,
          Buffer: true,
          setTimeout: true,
          clearTimeout: true,
          setInterval: true,
          clearInterval: true,
        },
        extraLibs: this.libs || [],
      });
      this.editor.__stateId = stateId;
      if (globalThis.NodeRedModuleIntellisense) {
        globalThis.NodeRedModuleIntellisense.sync();
      }
      installModuleEditorGlobalTypes(this);
      tabs.activateTab('module-tab-body');

      $('#node-module-expand-js').on('click', function (event) {
        event.preventDefault();
        const expanded = expandedEditorValue(
          node.editor,
          node.editor.getValue(),
        );
        node.editor.saveView();

        RED.editor.editJavaScript({
          value: expanded.value,
          width: 'Infinity',
          stateId: node.editor.__stateId,
          mode: 'ace/mode/nrjavascript',
          focus: true,
          extraLibs: getExternalModules(),
          cancel: function () {
            setTimeout(function () {
              node.editor.focus();
            }, 250);
          },
          complete: function (updatedValue) {
            node.editor.setValue(
              removeExpandedEditorHeader(updatedValue, expanded.addedHeader),
              -1,
            );
            setTimeout(function () {
              node.editor.restoreView();
              node.editor.focus();
            }, 250);
          },
        });
      });

      RED.popover.tooltip(
        $('#node-module-expand-js'),
        RED._('node-red:common.label.expand'),
      );
    },
    oneditsave: function () {
      const oldModuleName = this._moduleOriginalName;
      const newModuleName = $('#node-input-moduleName').val();
      const code = this.editor.getValue();
      const errors = editorErrorCount(this.editor);
      $('#node-input-func').val(code);
      $('#node-input-noerr').val(errors);
      this.func = code;
      this.outputs = Number($('#node-input-outputs').val());
      this.libs = getExternalModules();
      this.noerr = errors;
      updateReferencesForRename(this, oldModuleName, newModuleName);
      $('#node-input-moduleName').off('.moduleRename');
      delete this._moduleOriginalName;
      destroyEditor(this);
      if (globalThis.NodeRedModuleIntellisense) {
        globalThis.NodeRedModuleIntellisense.scheduleSync();
      }
    },
    oneditcancel: function () {
      $('#node-input-moduleName').off('.moduleRename');
      delete this._moduleOriginalName;
      destroyEditor(this);
    },
    oneditresize: function (size) {
      const height = Math.max(280, size.height - 185);
      const importHeight = Math.max(300, size.height - 155);
      $('#node-input-module-editor').css('height', height + 'px');
      $('.module-reference-table-wrap').css('max-height', height + 'px');
      $('#node-input-libs-container').css('height', importHeight + 'px');
      if (this.editor) {
        this.editor.resize();
      }
    },
  });
})();
