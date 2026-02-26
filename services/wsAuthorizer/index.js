// WebSocket $connect Lambda Authorizer
//
// API Gateway calls this before establishing any WebSocket connection.
// We check a static connectToken query-string parameter against the
// CONNECT_TOKEN env var. No DynamoDB read needed — wrong token means
// an immediate Deny with zero further resource usage.
//
// Connect URL format expected from the relay client:
//   wss://<api-id>.execute-api.<region>.amazonaws.com/<stage>?connectToken=<token>

export async function handler(event) {
  const token = event?.queryStringParameters?.connectToken;
  const methodArn = event?.methodArn;

  console.info("WS_AUTHORIZER:", {
    routeKey: event?.requestContext?.routeKey,
    connectionId: event?.requestContext?.connectionId,
    hasToken: !!token
  });

  const configuredToken = process.env.RELAY_TOKEN;
  if (!configuredToken) {
    console.error("WS_AUTHORIZER_FAIL: RELAY_TOKEN env var not set");
    return buildPolicy("Deny", methodArn);
  }

  if (!token || token !== configuredToken) {
    console.warn("WS_AUTHORIZER_DENY: invalid or missing connectToken");
    return buildPolicy("Deny", methodArn);
  }

  console.info("WS_AUTHORIZER_ALLOW:", { connectionId: event?.requestContext?.connectionId });
  return buildPolicy("Allow", methodArn);
}

function buildPolicy(effect, methodArn) {
  return {
    principalId: "relay-client",
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: effect,
          Resource: methodArn
        }
      ]
    }
  };
}
