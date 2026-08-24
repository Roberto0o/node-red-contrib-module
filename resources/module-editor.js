'use strict';

(function () {
  const MODULE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  const DEFAULT_CODE =
    'function hello() {\n' +
    '    return "hello";\n' +
    '}\n\n' +
    'module.exports = {\n' +
    '    hello\n' +
    '};';

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
    if (!node.editor) {
      return;
    }
    node.editor.destroy();
    delete node.editor;
  }

  RED.nodes.registerType('module', {
    category: 'function',
    color: '#fdd0a2',
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
          RED.tray.resize();
          if (node.editor) {
            node.editor.resize();
            node.editor.focus();
          }
        },
      });

      tabs.addTab({
        id: 'module-tab-body',
        iconClass: 'fa fa-code',
        label: 'Module',
      });
      tabs.activateTab('module-tab-body');

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
          useModule: true,
          moduleRef: true,
          console: true,
          Buffer: true,
          setTimeout: true,
          clearTimeout: true,
          setInterval: true,
          clearInterval: true,
        },
      });
      this.editor.__stateId = stateId;

      $('#node-module-expand-js').on('click', function (event) {
        event.preventDefault();
        const value = node.editor.getValue();
        node.editor.saveView();

        RED.editor.editJavaScript({
          value,
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
            node.editor.setValue(updatedValue, -1);
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
      this.noerr = errors;
      destroyEditor(this);
    },
    oneditcancel: function () {
      destroyEditor(this);
    },
    oneditresize: function (size) {
      const height = Math.max(150, size.height - 190);
      $('#node-input-module-editor').css('height', height + 'px');
      if (this.editor) {
        this.editor.resize();
      }
    },
  });
})();
