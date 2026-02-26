export const pk = {
  client: (clientId) => `CLIENT#${clientId}`,
  user: (userId) => `USER#${userId}`,
  conn: (connectionId) => `CONN#${connectionId}`
};

export const sk = {
  metadata: () => "METADATA",
  conn: () => "CONN",
  session: () => "SESSION",
  device: (deviceId) => `DEVICE#${deviceId}`,
  deletedDevice: (deviceId) => `DELETED#${deviceId}`
};

export function clientMetadataKey(clientId) {
  return { pk: pk.client(clientId), sk: sk.metadata() };
}

export function userMetadataKey(userId) {
  return { pk: pk.user(userId), sk: sk.metadata() };
}

export function connSessionKey(connectionId) {
  return { pk: pk.conn(connectionId), sk: sk.session() };
}

export function clientDeviceKey(clientId, deviceId) {
  return { pk: pk.client(clientId), sk: sk.device(deviceId) };
}

export function clientDeletedDeviceKey(clientId, deviceId) {
  return { pk: pk.client(clientId), sk: sk.deletedDevice(deviceId) };
}

export function clientConnectionKey(clientId) {
  return { pk: pk.client(clientId), sk: sk.conn() };
}
