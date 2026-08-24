# Module

`node-red-contrib-module`

Module adds reusable JavaScript libraries, classes, and services to the Node-RED editor. A Module runs once when it is deployed, exports a live API, and can be used from ordinary Function nodes anywhere in Node-RED without wires or `link-call` nodes.

## Features

- Write and maintain reusable JavaScript directly in the Node-RED editor.
- Keep the canvas display name separate from the programmatic Module Name.
- Import one module selectively with `global.get("useModule")("devices")`.
- Reference other modules lazily with `moduleRef("logging")`.
- Follow dependency redeploys automatically through live module references.
- Support synchronous or asynchronous module initialization.
- Run multiple synchronous or asynchronous `node.onClose()` cleanup handlers.
- Automatically clear timers created with the provided timer functions.
- Reject duplicate global Module Names in the editor and at runtime.
- Show loading, ready, duplicate, and error status below each Module node.

## Behaviour

Add a **Module** node from the Function palette. It has no inputs or outputs because it starts when flows are deployed rather than when a message arrives.

Configure the two names independently:

```text
Name:        Device Management Library
Module Name: devices
```

`Name` is the optional label shown on the canvas. `Module Name` is the required, process-wide lookup key. Module Names may contain letters, numbers, dots, underscores, and hyphens, and must match:

```text
^[A-Za-z0-9][A-Za-z0-9._-]*$
```

Leading and trailing whitespace is rejected rather than silently changing the identifier.

## Export and use a module

Module node named `test`:

```javascript
function hello() {
    return "hello";
}

module.exports = {
    hello
};
```

Normal Function node on any tab:

```javascript
const test = global.get("useModule")("test");

msg.payload = test.hello();

return msg;
```

`useModule("test")` returns only that module's current exports. Exports are live runtime values; they are not copied or JSON serialized.

Retrieve the module inside each Function-node invocation when callers should see a newly deployed implementation immediately:

```javascript
const devices = global.get("useModule")("devices");
const device = devices.get(msg.deviceId);

await device.setName("Ripening Room 04");

return msg;
```

## Use another module

Use `moduleRef()` for dependencies between Module nodes:

```javascript
const log = moduleRef("logging");

function addDevice(data) {
    log.info(`Device added: ${data.deviceId}`);
}

module.exports = {
    addDevice
};
```

`moduleRef("logging")` is lazy. Accessing `log.info` resolves the current `logging` exports at that moment. This reduces startup-order coupling and means the reference sees a redeployed dependency without redeploying the dependent Module.

Prefer a one-directional dependency graph. Circular dependencies are not supported in this version.

## Module environment

Module code receives:

```text
module          exports          node
context         flow             global
env             useModule        moduleRef
setTimeout      clearTimeout     setInterval
clearInterval
```

`env.get("NAME")` reads a Node-RED environment setting. `node` provides the Module identity, Node-RED logging functions, and `node.onClose()`.

Top-level `await` is supported:

```javascript
const connection = await openConnection();

module.exports = {
    connection
};
```

While initialization is pending, imports throw `Module '<name>' is not ready`. Syntax and initialization failures leave no stale exports and throw `Module '<name>' failed to load: <reason>`.

## Lifecycle

Register cleanup for connections, watchers, or other resources:

```javascript
const interval = setInterval(checkHealth, 10000);

node.onClose(async () => {
    clearInterval(interval);
    await connection.close();
});
```

Multiple callbacks are allowed and run in reverse registration order. The Module becomes unavailable before cleanup starts. Timers created through the provided timer functions are cleared automatically after callbacks complete.

## Shared state and concurrency

Every caller receives the same exported Module instance. The generic Module node does not serialize calls. Synchronous JavaScript is ordered by the Node.js event loop, but asynchronous operations can interleave.

Stateful business modules should own their concurrency model. For example, a `devices` module should expose device handles and patch operations, keep the authoritative records private, and serialize asynchronous mutations per device:

```javascript
await device.update({
    status: "Running",
    health: "OK",
    lastSeen: Date.now()
});
```

The registry stores functions, classes, Maps, Proxies, and exports only in process memory. Persist business data separately through Node-RED context, a file, SQLite, or another database.

## Errors

`useModule(name)` throws descriptive errors:

```text
Module 'devices' was not found
Module 'devices' is not ready
Module 'devices' failed to load: Database unavailable
Module name 'devices' is already registered by node <id>
```

Module Names are global and unique. A second node never silently replaces a different owner. Redeploying the same node ID is safe, and an old closing instance cannot remove its replacement.

## Security

Module code is trusted administrator/developer code. The evaluator is an organization boundary, not a security sandbox. Do not use it for hostile or untrusted JavaScript. `require()` is not provided as a Module argument in this version.

## Requirements

- Node-RED 5.0 or newer
- Node.js 22.9 or newer

## Contact

Found a bug, have a suggestion, or want to discuss the node?

- Start a topic on the [Node-RED Forum](https://discourse.nodered.org/) and tag me.
- Join the [Discord community](https://discord.gg/5KzTRv4g3W).

## License

Licensed under the [MIT License](LICENSE).
