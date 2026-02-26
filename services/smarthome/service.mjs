import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { alexaError, alexaResponse } from "../../shared/alexa/response.mjs";
import { clientDeviceKey, clientConnectionKey } from "../../shared/dynamo/keys.mjs";
import { isClientDeviceItem } from "../../shared/types/entities.mjs";

export async function handleSmartHomeDirective({ directive, repo, clientId }) {
  const header = directive?.header || {};
  const namespace = header.namespace;
  const name = header.name;
  const messageId = header.messageId || "placeholder-msg";
  const endpoint = directive?.endpoint;
  const correlationToken = header.correlationToken;

  if (!namespace || !name) {
    return alexaError({ type: "INVALID_DIRECTIVE", message: "Missing directive header", messageId });
  }

  if (namespace === "Alexa.Discovery" && name === "Discover") {
    return handleDiscovery({ repo, clientId, messageId });
  }

  if (namespace === "Alexa" && name === "ReportState") {
    return handleReportState({ repo, clientId, messageId, correlationToken, endpoint });
  }

  if (namespace.startsWith("Alexa.") && namespace.endsWith("Controller")) {
    return handleControl({ directive, repo, clientId, namespace, name, messageId, correlationToken, endpoint });
  }

  return alexaError({
    type: "INVALID_DIRECTIVE",
    message: `Unsupported directive: ${namespace}.${name}`,
    messageId,
    correlationToken,
    endpoint
  });
}

async function handleDiscovery({ repo, clientId, messageId }) {
  console.info("DISCOVERY_IN:", { messageId, clientId });
  const res = await repo.query(
    "pk = :pk AND begins_with(sk, :sk)",
    { ":pk": `CLIENT#${clientId}`, ":sk": "DEVICE#" }
  );
  const endpoints = (res?.Items ?? [])
    .filter(isClientDeviceItem)
    .map((item) => {
      const ep = item.endpoint;
      if (!ep) return null;
      return { ...ep, cookie: { ...(ep.cookie ?? {}), clientId } };
    })
    .filter(Boolean);
  console.info("DISCOVERY_OUT:", { messageId, count: endpoints.length });
  return alexaResponse({
    namespace: "Alexa.Discovery",
    name: "Discover.Response",
    messageId,
    payload: { endpoints }
  });
}

async function handleReportState({ repo, clientId, messageId, correlationToken, endpoint }) {
  const endpointId = endpoint?.endpointId;
  console.info("REPORTSTATE_IN:", { messageId, endpointId, clientId });
  if (!endpointId) {
    return alexaError({ type: "INVALID_DIRECTIVE", message: "Missing endpointId", messageId, correlationToken, endpoint });
  }

  const res = await repo.get(clientDeviceKey(clientId, endpointId));
  const item = res?.Item;
  if (!item) {
    console.warn("REPORTSTATE_MISS:", { messageId, endpointId, clientId });
    return alexaError({ type: "NO_SUCH_ENDPOINT", message: "Device not found", messageId, correlationToken, endpoint });
  }

  const properties = propsFromDeviceItem(item);
  console.info("REPORTSTATE_OUT:", { messageId, endpointId, properties: properties.length });
  return {
    context: { properties },
    ...alexaResponse({
      namespace: "Alexa",
      name: "StateReport",
      messageId,
      correlationToken,
      endpoint: { endpointId, cookie: endpoint?.cookie },
      payload: {}
    })
  };
}

async function handleControl({ directive, repo, clientId, namespace, name, messageId, correlationToken, endpoint }) {
  const endpointId = endpoint?.endpointId;
  console.info("CONTROL_IN:", { messageId, directive: `${namespace}.${name}`, endpointId, clientId });
  if (!endpointId) {
    return alexaError({ type: "INVALID_DIRECTIVE", message: "Missing endpointId", messageId, correlationToken, endpoint });
  }

  // Verify device exists before forwarding
  const deviceRes = await repo.get(clientDeviceKey(clientId, endpointId));
  if (!deviceRes?.Item) {
    console.warn("CONTROL_MISS:", { messageId, endpointId, clientId });
    return alexaError({ type: "NO_SUCH_ENDPOINT", message: "Device not found", messageId, correlationToken, endpoint });
  }

  // Push directive to relay client
  await postDirectiveToClient(clientId, directive, repo);

  // Build optimistic response
  const now = new Date().toISOString();
  const contextProps = [];

  const addProp = (ns, pname, val) => contextProps.push({
    namespace: ns, name: pname, value: val,
    timeOfSample: now, uncertaintyInMilliseconds: 200
  });

  if (namespace === "Alexa.PowerController") {
    if (name === "TurnOn") addProp(namespace, "powerState", "ON");
    else if (name === "TurnOff") addProp(namespace, "powerState", "OFF");
  } else if (namespace === "Alexa.BrightnessController" && name === "SetBrightness") {
    addProp(namespace, "brightness", directive?.payload?.brightness);
  } else if (namespace === "Alexa.ColorController" && name === "SetColor") {
    addProp(namespace, "color", directive?.payload?.color);
  } else if (namespace === "Alexa.ColorTemperatureController" && name === "SetColorTemperature") {
    addProp(namespace, "colorTemperatureInKelvin", directive?.payload?.colorTemperatureInKelvin);
  }

  console.info("CONTROL_OUT:", { messageId, endpointId, namespace, name });
  return {
    context: contextProps.length ? { properties: contextProps } : undefined,
    ...alexaResponse({
      namespace: "Alexa",
      name: "Response",
      messageId,
      correlationToken,
      endpoint: { endpointId },
      payload: {}
    })
  };
}

async function postDirectiveToClient(clientId, directive, repo) {
  const WS_MGMT_ENDPOINT = process.env.WS_MGMT_ENDPOINT;
  if (!WS_MGMT_ENDPOINT) {
    console.warn("WS_SEND_SKIP: No WS_MGMT_ENDPOINT");
    return;
  }

  const connRes = await repo.get(clientConnectionKey(clientId));
  const connectionId = connRes?.Item?.connectionId;
  if (!connectionId) {
    console.warn("WS_SEND_SKIP: No active connection for client", clientId);
    return;
  }

  const mgmt = new ApiGatewayManagementApiClient({ endpoint: WS_MGMT_ENDPOINT });
  const payload = { type: "alexaDirective", directive };
  try {
    await mgmt.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(payload), "utf8")
    }));
    console.info("WS_SEND_OK:", { connectionId, clientId });
  } catch (err) {
    console.warn("WS_SEND_FAIL:", { connectionId, error: err?.message });
  }
}

function defaultPowerStateProp() {
  return {
    namespace: "Alexa.PowerController",
    name: "powerState",
    value: "OFF",
    timeOfSample: new Date().toISOString(),
    uncertaintyInMilliseconds: 1000
  };
}

function propsFromDeviceItem(item) {
  if (Array.isArray(item?.state?.properties) && item.state.properties.length > 0) {
    return item.state.properties;
  }
  return [defaultPowerStateProp()];
}
