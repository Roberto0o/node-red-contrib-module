'use strict';

function createLifecycle() {
  const closeCallbacks = [];
  const timeouts = new Set();
  const intervals = new Set();
  let closed = false;

  function onClose(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('node.onClose(callback) requires a function');
    }
    if (closed) {
      throw new Error('Cannot register a close callback after cleanup has started');
    }
    closeCallbacks.push(callback);
  }

  function trackedSetTimeout(callback, delay) {
    if (typeof callback !== 'function') {
      throw new TypeError('setTimeout(callback) requires a function');
    }
    const args = Array.prototype.slice.call(arguments, 2);
    let handle;
    handle = setTimeout(function () {
      timeouts.delete(handle);
      callback.apply(undefined, args);
    }, delay);
    timeouts.add(handle);
    return handle;
  }

  function trackedClearTimeout(handle) {
    timeouts.delete(handle);
    clearTimeout(handle);
  }

  function trackedSetInterval(callback, delay) {
    if (typeof callback !== 'function') {
      throw new TypeError('setInterval(callback) requires a function');
    }
    const args = Array.prototype.slice.call(arguments, 2);
    const handle = setInterval(function () {
      callback.apply(undefined, args);
    }, delay);
    intervals.add(handle);
    return handle;
  }

  function trackedClearInterval(handle) {
    intervals.delete(handle);
    clearInterval(handle);
  }

  async function close() {
    if (closed) {
      return [];
    }
    closed = true;

    const errors = [];
    for (let index = closeCallbacks.length - 1; index >= 0; index -= 1) {
      try {
        await closeCallbacks[index]();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    timeouts.forEach(clearTimeout);
    intervals.forEach(clearInterval);
    timeouts.clear();
    intervals.clear();
    closeCallbacks.length = 0;

    return errors;
  }

  return {
    onClose,
    close,
    timers: {
      setTimeout: trackedSetTimeout,
      clearTimeout: trackedClearTimeout,
      setInterval: trackedSetInterval,
      clearInterval: trackedClearInterval,
    },
  };
}

module.exports = {
  createLifecycle,
};
