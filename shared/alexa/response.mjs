export function alexaResponse({
  namespace = "Alexa",
  name,
  messageId = "placeholder-msg",
  correlationToken,
  endpoint,
  payload = {}
}) {
  const header = {
    namespace,
    name,
    payloadVersion: "3",
    messageId
  };
  if (correlationToken) header.correlationToken = correlationToken;

  const evt = { header, payload };
  if (endpoint) evt.endpoint = endpoint;
  return { event: evt };
}

export function alexaError({
  type = "INTERNAL_ERROR",
  message = "Internal error",
  messageId,
  correlationToken,
  endpoint
} = {}) {
  return alexaResponse({
    namespace: "Alexa",
    name: "ErrorResponse",
    messageId,
    correlationToken,
    endpoint,
    payload: { type, message }
  });
}

