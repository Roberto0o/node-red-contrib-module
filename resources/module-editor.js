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
  const ACE_MODULE_GLOBALS_HEADER = '/* global emit, modules */\n';
  const MODULE_EDITOR_GLOBAL_TYPES =
    'declare const modules: NodeRedModuleRegistry;\n' +
    'declare function emit(outputNumber: number, msg: any): void;\n';

  function isUniqueModuleName(node, value) {
    let unique = true;

    RED.nodes.eachNode(function (candidate) {
      if (
        candidate.type === 'module' &&
        candidate.id !== node.id &&
        candidate.moduleName === value
      ) {
        unique = false;
      }
    });

    return unique;
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
    const scanner = globalThis.NodeRedModuleReferences;
    const moduleName = $('#node-input-moduleName').val() || owner.moduleName;
    const allNodes = [];
    RED.nodes.eachNode(function (node) {
      allNodes.push(node);
    });

    const references = scanner
      ? scanner
          .findReferences(allNodes, moduleName, owner.id)
          .filter(isActiveNode)
      : [];
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
      const tabs = RED.tabs.create({
        id: 'module-tabs',
        onchange: function (tab) {
          $('#module-tabs-content').children().hide();
          $('#' + tab.id).show();
          if (tab.id === 'module-tab-references') {
            renderReferences(node);
          }
          RED.tray.resize();
          if (tab.id === 'module-tab-body' && node.editor) {
            node.editor.resize();
            node.editor.focus();
          }
        },
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
          console: true,
          Buffer: true,
          setTimeout: true,
          clearTimeout: true,
          setInterval: true,
          clearInterval: true,
        },
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
      const code = this.editor.getValue();
      const errors = editorErrorCount(this.editor);
      $('#node-input-func').val(code);
      $('#node-input-noerr').val(errors);
      this.func = code;
      this.outputs = Number($('#node-input-outputs').val());
      this.noerr = errors;
      destroyEditor(this);
      if (globalThis.NodeRedModuleIntellisense) {
        globalThis.NodeRedModuleIntellisense.scheduleSync();
      }
    },
    oneditcancel: function () {
      destroyEditor(this);
    },
    oneditresize: function (size) {
      const height = Math.max(150, size.height - 230);
      $('#node-input-module-editor').css('height', height + 'px');
      $('.module-reference-table-wrap').css('max-height', height + 'px');
      if (this.editor) {
        this.editor.resize();
      }
    },
  });
})();
