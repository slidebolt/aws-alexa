export function isClientMetadataItem(item) {
  return Boolean(
    item &&
      typeof item.pk === "string" &&
      item.pk.startsWith("CLIENT#") &&
      item.sk === "METADATA"
  );
}

export function toClientListItem(item) {
  return {
    clientId: item.pk.slice("CLIENT#".length),
    label: item.label || "",
    active: item.active !== false,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null
  };
}

export function isClientDeviceItem(item) {
  return Boolean(
    item &&
      typeof item.pk === "string" &&
      item.pk.startsWith("CLIENT#") &&
      typeof item.sk === "string" &&
      item.sk.startsWith("DEVICE#")
  );
}

export function toDeviceListItem(item) {
  return {
    clientId: item.pk.slice("CLIENT#".length),
    deviceId: item.sk.slice("DEVICE#".length),
    endpointId: item.endpointId || item.endpoint?.endpointId || null,
    endpoint: item.endpoint || null,
    state: item.state || null,
    status: item.status || null,
    updatedAt: item.updatedAt || null
  };
}
