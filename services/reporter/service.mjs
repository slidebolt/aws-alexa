export async function handleReporterEvent({
  event,
  repo,
  tokenResolver = async () => null,
  reportSender = async () => {}
}) {
  const records = Array.isArray(event?.Records) ? event.Records : [];
  let changed = 0;
  let sent = 0;

  for (const record of records) {
    const normalized = normalizeRecord(record);
    if (!normalized) continue;
    changed += 1;

    console.info("REPORTER_RECORD:", { kind: normalized.kind, clientId: normalized.clientId, deviceId: normalized.deviceId });

    if (!repo || typeof repo.get !== "function") continue;
    const metaRes = await repo.get({ pk: `CLIENT#${normalized.clientId}`, sk: "METADATA" });
    const meta = metaRes?.Item;
    const userId = meta?.ownerUserId;
    if (!userId) {
      console.warn("REPORTER_SKIP:", { reason: "no_owner", clientId: normalized.clientId, deviceId: normalized.deviceId });
      continue;
    }

    const accessToken = await tokenResolver(userId);
    if (!accessToken) {
      console.warn("REPORTER_SKIP:", { reason: "no_token", clientId: normalized.clientId, deviceId: normalized.deviceId });
      continue;
    }

    const payload = normalized.kind === "delete"
      ? buildDeleteReport({ endpointId: normalized.deviceId, accessToken })
      : buildChangeReport({
          endpointId: normalized.deviceId,
          accessToken,
          properties: propsFromRecord(normalized.newImage)
        });

    console.info("REPORTER_SEND:", { kind: normalized.kind, deviceId: normalized.deviceId });
    await reportSender(payload, normalized);
    sent += 1;
  }

  return {
    ok: true,
    processed: records.length,
    changed,
    sent
  };
}

function normalizeRecord(record) {
  if (!record || !["INSERT", "MODIFY", "REMOVE"].includes(record.eventName)) return null;
  const oldImage = record.oldImage || null;
  const newImage = record.newImage || null;
  const image = record.eventName === "REMOVE" ? oldImage : newImage;
  const pk = image?.pk || oldImage?.pk || newImage?.pk;
  const sk = image?.sk || oldImage?.sk || newImage?.sk;
  if (!pk || !sk || !String(sk).startsWith("DEVICE#") || !String(pk).startsWith("CLIENT#")) {
    return null;
  }

  const clientId = String(pk).slice("CLIENT#".length);
  const deviceId = String(sk).slice("DEVICE#".length);

  if (record.eventName === "REMOVE") {
    return { kind: "delete", clientId, deviceId, oldImage, newImage };
  }

  const oldStatus = oldImage?.status;
  const newStatus = newImage?.status;
  const softDelete = oldStatus === "active" && newStatus === "deleted";
  if (softDelete) {
    return { kind: "delete", clientId, deviceId, oldImage, newImage };
  }

  const oldState = JSON.stringify(oldImage?.state || {});
  const newState = JSON.stringify(newImage?.state || {});
  if (oldState === newState) return null;
  return { kind: "change", clientId, deviceId, oldImage, newImage };
}

function propsFromRecord(image) {
  if (Array.isArray(image?.state?.properties) && image.state.properties.length > 0) {
    return image.state.properties;
  }
  if (typeof image?.state?.powerState === "string") {
    return [
      {
        namespace: "Alexa.PowerController",
        name: "powerState",
        value: image.state.powerState,
        timeOfSample: image.updatedAt || new Date().toISOString(),
        uncertaintyInMilliseconds: 1000
      }
    ];
  }
  return [];
}

function buildDeleteReport({ endpointId, accessToken }) {
  return {
    event: {
      header: {
        namespace: "Alexa.Discovery",
        name: "DeleteReport",
        payloadVersion: "3",
        messageId: `delete-${Date.now()}-${endpointId}`
      },
      payload: {
        endpoints: [{ endpointId }],
        scope: { type: "BearerToken", token: accessToken }
      }
    }
  };
}

function buildChangeReport({ endpointId, accessToken, properties }) {
  return {
    event: {
      header: {
        namespace: "Alexa",
        name: "ChangeReport",
        payloadVersion: "3",
        messageId: `change-${Date.now()}-${endpointId}`
      },
      endpoint: {
        scope: { type: "BearerToken", token: accessToken },
        endpointId
      },
      payload: {
        change: {
          cause: { type: "PHYSICAL_INTERACTION" },
          properties
        }
      }
    }
  };
}
