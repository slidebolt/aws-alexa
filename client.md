# plugin-alexa Client vs `API.md` Contract

This document lists the key differences between the current Go `plugin-alexa` relay client implementation and the contract described in `API.md`.

## Critical Mismatches

### 1. `list_devices` response parsing

`API.md` contract:
- Success response uses `devices`
- Shape: `{ "ok": true, "devices": [ ... ] }`

Current client behavior:
- Expects `action == "list_devices"`
- Expects `items` array (not `devices`)

Impact:
- Valid `list_devices` responses documented in `API.md` may be ignored.
- `list_devices`, `clean_alexa`, and sync comparison workflows can fail silently.

## 2. `device_delete` success acknowledgement parsing

`API.md` contract:
- Success response shape: `{ "ok": true, "status": "deleted", "deviceId": "..." }`

Current client behavior:
- Expects delete ack in shape like: `{ "ok": true, "action": "device_delete", "accepted": true, ... }`

Impact:
- Pending delete tracking may not clear after successful deletes.
- Retry logic may keep re-sending deletes unnecessarily.

## Important Differences

### 3. `list_devices` item fields used by client

`API.md` documents list items with fields such as:
- `deviceId`
- `endpointId`
- `status`
- `updatedAt`

Current client comparison/logging expects cloud item names from:
- `friendlyName`

Impact:
- Cloud device names in logs/comparison output may be blank.
- Functional matching still works if `endpointId` is present.

### 4. `state_update.state` payload shape

`API.md` describes `state` as an arbitrary key/value object and shows examples like:
- `{ "powerState": "ON" }`

Current client sends Alexa-style property arrays in `state`, e.g.:
- `{ "properties": [ ... ] }`

Impact:
- May still work if relay stores and replays arbitrary JSON as-is.
- But this differs from the documented contract and should be explicitly aligned (docs or client).

## Non-Breaking Differences (Operational)

### 5. `keepalive` interval

`API.md` recommendation:
- Send keepalive every ~8 minutes

Current client behavior:
- Sends keepalive every 30 seconds

Impact:
- Not necessarily protocol-breaking
- Extra noise/traffic and can complicate debugging

### 6. Extra fields sent beyond documented minimums

Current client sends additional fields not required by `API.md`, for example:
- `device_upsert`: may include `event` and `state`
- `device_delete`: may include `event`
- `state_update`: includes `ts`

Impact:
- Usually safe if server ignores unknown fields
- Still outside the documented minimum contract

## Notes on `register`

`API.md` register success shape is:
- `{ "ok": true, "action": "register", "accepted": true, ... }`

Current client register-ack parsing is strict to this shape.

Implication:
- If the client connects, receives a register response, and disconnects ~10s later, then the deployed server's actual register success payload may differ from `API.md` (docs/runtime drift).

## Priority Fixes (Client)

1. Parse `list_devices` success using `devices` (not `items`)
2. Parse `device_delete` success using `status == "deleted"`
3. Decide and align `state_update.state` shape (flat object vs Alexa `properties[]` wrapper)
