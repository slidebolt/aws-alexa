# SlideBolt Relay WebSocket API

## Connection

**Endpoint:** `wss://<api-id>.execute-api.<region>.amazonaws.com`

All messages are JSON text frames. Every response includes `"ok": true` on success or `"ok": false` on error.

---

## Session Lifecycle

1. Connect to the WebSocket endpoint
2. Send `register` immediately — this is required before any other action
3. Wait for the `register` success response before sending anything else
4. Send `keepalive` periodically to prevent the API Gateway 10-minute idle disconnect
5. On disconnect, reconnect and re-register from step 2

---

## Actions

### `register`

Must be the first message sent after connecting. All other actions return `403` until this succeeds.

**Send:**
```json
{
  "action": "register",
  "clientId": "<clientId>",
  "secret": "<rawSecret>"
}
```

**Success response:**
```json
{
  "ok": true,
  "action": "register",
  "accepted": true,
  "connectionId": "<connectionId>",
  "clientId": "<clientId>"
}
```

**Error responses:**
```json
{ "ok": false, "error": "Invalid client" }
{ "ok": false, "error": "Client inactive" }
{ "ok": false, "error": "Invalid secret" }
```

---

### `keepalive`

Send periodically (every 30 seconds or less) to reset the API Gateway idle connection timer and prevent disconnect.

**Send:**
```json
{
  "action": "keepalive"
}
```

**Response:**
```json
{
  "ok": true,
  "type": "keepalive",
  "ts": 1234567890123
}
```

`ts` is the server epoch time in milliseconds.

---

### `device_upsert`

Create or update a device. The `endpoint` object is stored and used for Alexa discovery. Optionally include `state` to set the device's initial reported state in the same call.

**Send:**
```json
{
  "action": "device_upsert",
  "clientId": "<clientId>",
  "endpoint": {
    "endpointId": "<deviceId>",
    "friendlyName": "Lamp",
    ...
  },
  "state": {
    "properties": [...]
  }
}
```

`state` is optional. If omitted, existing state is preserved.

**Response:**
```json
{
  "ok": true,
  "action": "device_upsert",
  "accepted": true,
  "deviceId": "<endpointId>"
}
```

---

### `list_devices`

Fetch the current list of devices registered for the client.

**Send:**
```json
{
  "action": "list_devices",
  "clientId": "<clientId>"
}
```

**Response:**
```json
{
  "ok": true,
  "devices": [
    {
      "endpointId": "<id>",
      "friendlyName": "Lamp",
      "state": { "properties": [...] },
      "status": "active",
      "updatedAt": "<iso8601>"
    }
  ]
}
```

Each item spreads the full `endpoint` object (same fields sent in `device_upsert`), plus `state`, `status`, and `updatedAt`. Devices are sorted by `endpointId`. `status` is `"active"` or `"deleted"`.

---

### `state_update`

Update the reported state of a device. The stored state is returned directly to Alexa on `ReportState` queries.

**Send:**
```json
{
  "action": "state_update",
  "clientId": "<clientId>",
  "deviceId": "<deviceId>",
  "state": {
    "properties": [
      {
        "namespace": "Alexa.PowerController",
        "name": "powerState",
        "value": "ON",
        "timeOfSample": "2026-02-25T15:00:00.000000000Z",
        "uncertaintyInMilliseconds": 500
      }
    ]
  }
}
```

The `state.properties` array contains Alexa-style property objects. Supported namespaces:

| Namespace | `name` | `value` type |
|---|---|---|
| `Alexa.PowerController` | `powerState` | `"ON"` or `"OFF"` |
| `Alexa.BrightnessController` | `brightness` | integer 0–100 |
| `Alexa.ColorTemperatureController` | `colorTemperatureInKelvin` | integer (e.g. 2700) |
| `Alexa.ColorController` | `color` | `{ "hue": 0.0, "saturation": 0.0, "brightness": 0.0 }` |

Multiple properties can be included in a single `state_update`.

**Response:**
```json
{
  "ok": true,
  "action": "state_update",
  "accepted": true,
  "deviceId": "<deviceId>"
}
```

---

### `device_delete`

Delete a device. Alias `delete_device` is also accepted.

**Send:**
```json
{
  "action": "device_delete",
  "clientId": "<clientId>",
  "deviceId": "<deviceId>"
}
```

**Response:**
```json
{
  "ok": true,
  "status": "deleted",
  "deviceId": "<deviceId>"
}
```

---

## Server-Pushed Messages

These are sent by the server at any time after a successful `register`, without a corresponding client request.

### Alexa Directive

Forwarded from Alexa when a user issues a voice command (e.g. "turn on the lamp").

```json
{
  "type": "alexaDirective",
  ...
}
```

---

## Error Shapes

### Auth failure

Returned for any action sent before `register` succeeds, or if the session has expired.

```json
{
  "ok": false,
  "error": "Not registered"
}
```

### Validation error

```json
{
  "ok": false,
  "error": "<message>"
}
```

### Internal error

```json
{
  "ok": false,
  "error": "Internal Server Error"
}
```

All error responses use HTTP status `400` (bad request), `403` (unauthorized), or `500` (internal error). The WebSocket connection remains open after any error response.
