# SlideBolt Relay — Server Contract

## WebSocket Endpoint

`wss://<api-id>.execute-api.<region>.amazonaws.com`

All messages are JSON text frames. Every response body is JSON.

---

## Authentication Model

The server resolves identity from the session, not from the message body.

1. `register` is the only unauthenticated action. It validates `clientId` + `secret` against the stored `secretHash`, then writes a session keyed to the `connectionId`.
2. Every other action requires a valid session for the connection. If none exists, the server returns `{ "error": "Unauthorized" }` and the connection stays open.
3. If a message includes `clientId` in the body, it must match the session's `clientId`. Mismatch returns `{ "error": "Unauthorized" }`.

---

## Actions

### `register`

Validates credentials, writes session. Must succeed before any other action.

**Receive:**
```json
{ "action": "register", "clientId": "<id>", "secret": "<rawSecret>" }
```

**Send on success:**
```json
{ "ok": true, "action": "register", "accepted": true, "connectionId": "<id>", "clientId": "<id>" }
```

**Send on failure:**
```json
{ "ok": false, "error": "Invalid client" }
{ "ok": false, "error": "Client inactive" }
{ "ok": false, "error": "Invalid secret" }
```

---

### `device_upsert`

Stores or updates a device record. Uses DynamoDB UPDATE to preserve `firstSeen`. Stores `state` if provided.

**Receive:**
```json
{
  "action": "device_upsert",
  "clientId": "<id>",
  "endpoint": { "endpointId": "<id>", "friendlyName": "...", ... },
  "state": { "properties": [...] }
}
```

`state` is optional. Any extra fields (`event`, etc.) are ignored.

**Send:**
```json
{ "ok": true, "action": "device_upsert", "accepted": true, "deviceId": "<endpointId>" }
```

---

### `device_delete` (alias: `delete_device`)

Deletes the device record from DynamoDB.

**Receive:**
```json
{ "action": "device_delete", "clientId": "<id>", "deviceId": "<id>" }
```

Any extra fields (`event`, etc.) are ignored.

**Send:**
```json
{ "ok": true, "status": "deleted", "deviceId": "<id>" }
```

---

### `list_devices`

Queries all `DEVICE#` records for the client. Returns the full endpoint object spread alongside state, status, and updatedAt.

**Receive:**
```json
{ "action": "list_devices", "clientId": "<id>" }
```

**Send:**
```json
{
  "ok": true,
  "devices": [
    {
      "endpointId": "<id>",
      "friendlyName": "...",
      "state": { "properties": [...] },
      "status": "active",
      "updatedAt": "<iso8601>"
    }
  ]
}
```

`status` is `"active"` or `"deleted"`. Devices are sorted by `endpointId`. Each item is the full `endpoint` object spread, plus `state`, `status`, `updatedAt`.

---

### `state_update`

Stores device state. The `state` object is stored as-is and returned directly to Alexa on `ReportState`.

**Receive:**
```json
{
  "action": "state_update",
  "clientId": "<id>",
  "deviceId": "<id>",
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

Extra fields (`ts`, etc.) are ignored.

**Send:**
```json
{ "ok": true, "action": "state_update", "accepted": true, "deviceId": "<id>" }
```

---

### `keepalive`

Resets the API Gateway idle timer. Send every 30 seconds or less.

**Receive:**
```json
{ "action": "keepalive" }
```

**Send:**
```json
{ "ok": true, "type": "keepalive", "ts": 1234567890123 }
```

---

## Connection Lifecycle

### `$connect`

API Gateway lifecycle event. Server returns 200, no body sent to client.

### `$disconnect`

API Gateway lifecycle event. Server deletes the session and connection records for the connection.

---

## Error Responses

| Condition | Body |
|---|---|
| No session / not registered | `{ "ok": false, "error": "Unauthorized" }` |
| body.clientId does not match session | `{ "ok": false, "error": "Unauthorized" }` |
| Missing required field | `{ "ok": false, "error": "Missing <field>" }` |
| Unknown action | `{ "ok": false, "error": "Unsupported relay action" }` |
| Internal error | `{ "ok": false, "error": "Internal Server Error" }` |

The WebSocket connection remains open after all error responses.

---

## State Shape

`state` in both `state_update` and `device_upsert` must be an Alexa-style property wrapper:

```json
{
  "properties": [
    {
      "namespace": "<Alexa namespace>",
      "name": "<property name>",
      "value": "<value>",
      "timeOfSample": "<rfc3339nano>",
      "uncertaintyInMilliseconds": 500
    }
  ]
}
```

Supported namespaces:

| Namespace | `name` | `value` |
|---|---|---|
| `Alexa.PowerController` | `powerState` | `"ON"` or `"OFF"` |
| `Alexa.BrightnessController` | `brightness` | integer 0–100 |
| `Alexa.ColorTemperatureController` | `colorTemperatureInKelvin` | integer (e.g. 2700) |
| `Alexa.ColorController` | `color` | `{ "hue": 0.0, "saturation": 0.0, "brightness": 0.0 }` |
