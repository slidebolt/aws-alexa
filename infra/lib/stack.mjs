import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as appregistry from "aws-cdk-lib/aws-servicecatalogappregistry";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const lambdaAssetCode = lambda.Code.fromAsset(ROOT, {
  exclude: [
    "infra/**",
    "tests/**",
    "coverage/**",
    "dist/**",
    "cdk.out/**",
    ".git/**",
    ".env*",
    "cdk-outputs.json"
  ]
});

export class SldBltStack extends cdk.Stack {
  constructor(scope, id, props = {}) {
    super(scope, id, props);

    const stage = "prod";
    const prefix = "SldBlt";

    const application = new appregistry.CfnApplication(this, "AppRegistryApplication", {
      name: `${prefix}-${stage}`,
      description: "SlideBolt Smart Home Infrastructure"
    });

    new appregistry.CfnResourceAssociation(this, "AppRegistryAssociation", {
      application: application.attrId,
      resource: this.stackId,
      resourceType: "CFN_STACK"
    });

    const wsSharedSecret = new cdk.CfnParameter(this, "AdminSecret", {
      type: "String",
      noEcho: true,
      description: "Shared secret for SlideBolt Admin WebSocket actions."
    });

    const connectToken = new cdk.CfnParameter(this, "RelayToken", {
      type: "String",
      noEcho: true,
      description: "Static token required in ?connectToken= query string to establish a WebSocket connection."
    });

    const alexaSkillId = new cdk.CfnParameter(this, "AlexaSkillId", {
      type: "String",
      description: "Alexa Smart Home Skill ID for Lambda invoke permission."
    });

    const usersTable = new dynamodb.Table(this, "UsersTable", {
      tableName: `${prefix}Users-v2-${stage}`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    usersTable.addGlobalSecondaryIndex({
      indexName: "OwnerEmailIndex",
      partitionKey: { name: "ownerEmail", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    const devicesTable = new dynamodb.Table(this, "DevicesTable", {
      tableName: `${prefix}Devices-v2-${stage}`,
      partitionKey: { name: "clientId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: "ttl",
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    const dataTable = new dynamodb.Table(this, "DataTable", {
      tableName: `${prefix}Data-v1-${stage}`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: "ttl",
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES
    });

    dataTable.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    const wsAuthorizer = new lambda.Function(this, "WsAuthorizerLambda", {
      functionName: `${prefix}WsAuthorizer`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "slideBoltWsAuthorizer.handler",
      code: lambdaAssetCode,
      timeout: cdk.Duration.seconds(5),
      environment: {
        RELAY_TOKEN: connectToken.valueAsString
      }
    });

    const reporterLambda = new lambda.Function(this, "ReporterLambda", {
      functionName: `${prefix}Reporter`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "slideBoltReporter.handler",
      code: lambdaAssetCode,
      timeout: cdk.Duration.seconds(15),
      environment: {
        DATA_TABLE: dataTable.tableName,
        ALEXA_CLIENT_ID: process.env.ALEXA_CLIENT_ID || "",
        ALEXA_CLIENT_SECRET: process.env.ALEXA_CLIENT_SECRET || ""
      }
    });

    const wsRelay = new lambda.Function(this, "WsRelayLambda", {
      functionName: `${prefix}Relay`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "slideBoltWsRelay.handler",
      code: lambdaAssetCode,
      timeout: cdk.Duration.seconds(10),
      environment: {
        DATA_TABLE: dataTable.tableName
      }
    });

    const smartHome = new lambda.Function(this, "SmartHomeLambda", {
      functionName: `${prefix}SmartHome`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "slideBoltSmartHome.handler",
      code: lambdaAssetCode,
      timeout: cdk.Duration.seconds(10),
      environment: {
        DATA_TABLE: dataTable.tableName,
        TEST_ALEXA_TOKEN: process.env.TEST_ALEXA_TOKEN || "",
        ALEXA_CLIENT_ID: process.env.ALEXA_CLIENT_ID || "",
        ALEXA_CLIENT_SECRET: process.env.ALEXA_CLIENT_SECRET || ""
      }
    });

    const adminLambda = new lambda.Function(this, "AdminLambda", {
      functionName: `${prefix}Admin`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "slideBoltAdmin.handler",
      code: lambdaAssetCode,
      timeout: cdk.Duration.seconds(10),
      environment: {
        DATA_TABLE: dataTable.tableName,
        ADMIN_SECRET: wsSharedSecret.valueAsString
      }
    });

    dataTable.grantReadWriteData(wsRelay);

    dataTable.grantReadWriteData(smartHome);

    dataTable.grantReadWriteData(adminLambda);

    dataTable.grantReadWriteData(reporterLambda);
    reporterLambda.addEventSource(new lambdaEventSources.DynamoEventSource(dataTable, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 5,
      bisectBatchOnError: true,
      retryAttempts: 3
    }));

    const wsApi = new apigwv2.WebSocketApi(this, "WsApi", {
      apiName: `${prefix}WsApi-${stage}`,
      routeSelectionExpression: "$request.body.action"
    });

    const wsStage = new apigwv2.WebSocketStage(this, "WsStage", {
      webSocketApi: wsApi,
      stageName: stage,
      autoDeploy: true
    });

    const relayIntegration = new apigwv2Integrations.WebSocketLambdaIntegration(
      "WsRelayIntegration",
      wsRelay
    );

    const adminIntegration = new apigwv2Integrations.WebSocketLambdaIntegration(
      "AdminIntegration",
      adminLambda
    );

    // Lambda Authorizer for $connect — checks ?connectToken before any connection is accepted.
    // Wrong or missing token → Deny (no DynamoDB hit, no connection established).
    const cfnAuthorizer = new apigwv2.CfnAuthorizer(this, "WsConnectAuthorizer", {
      apiId: wsApi.apiId,
      authorizerType: "REQUEST",
      name: "WsConnectAuthorizer",
      authorizerUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${wsAuthorizer.functionArn}/invocations`,
      identitySource: ["route.request.querystring.connectToken"]
    });

    // Allow API Gateway to invoke the authorizer Lambda
    wsAuthorizer.addPermission("ApiGatewayAuthorizerInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: cdk.Stack.of(this).formatArn({
        service: "execute-api",
        resource: wsApi.apiId,
        resourceName: "authorizers/*"
      })
    });

    // Add $connect with authorizer wired in via escape hatch on the underlying CfnRoute
    const connectRoute = wsApi.addRoute("$connect", { integration: relayIntegration });
    const cfnConnectRoute = connectRoute.node.defaultChild;
    cfnConnectRoute.authorizationType = "CUSTOM";
    cfnConnectRoute.authorizerId = cfnAuthorizer.ref;
    wsApi.addRoute("$disconnect", { integration: relayIntegration });
    wsApi.addRoute("$default", { integration: relayIntegration, returnResponse: true });
    wsApi.addRoute("register", { integration: relayIntegration, returnResponse: true });
    wsApi.addRoute("state_update", { integration: relayIntegration, returnResponse: true });
    wsApi.addRoute("device_upsert", { integration: relayIntegration, returnResponse: true });
    wsApi.addRoute("list_devices", { integration: relayIntegration, returnResponse: true });
    wsApi.addRoute("delete_device", { integration: relayIntegration, returnResponse: true });
    wsApi.addRoute("keepalive", { integration: relayIntegration, returnResponse: true });

    wsApi.addRoute("admin_create_client", { integration: adminIntegration, returnResponse: true });
    wsApi.addRoute("admin_list_clients", { integration: adminIntegration, returnResponse: true });
    wsApi.addRoute("admin_revoke_client", { integration: adminIntegration, returnResponse: true });
    wsApi.addRoute("admin_update_client", { integration: adminIntegration, returnResponse: true });
    wsApi.addRoute("admin_delete_client", { integration: adminIntegration, returnResponse: true });
    wsApi.addRoute("admin_add_user_to_client", { integration: adminIntegration, returnResponse: true });
    wsApi.addRoute("admin_remove_user_from_client", { integration: adminIntegration, returnResponse: true });
    wsApi.addRoute("admin_list_client_users", { integration: adminIntegration, returnResponse: true });

    const grantInvoke = (fn, routes, idPrefix) => {
      routes.forEach((route) => {
        const cleanRoute = route
          .replace(/\$/g, "")
          .replace(/_([a-z])/g, (g) => g[1].toUpperCase())
          .replace(/^_/, "") || "Default";
        const idSuffix = cleanRoute.charAt(0).toUpperCase() + cleanRoute.slice(1);

        new lambda.CfnPermission(this, `${idPrefix}InvokePermission${idSuffix}`, {
          action: "lambda:InvokeFunction",
          functionName: fn.functionArn,
          principal: "apigateway.amazonaws.com",
          sourceArn: cdk.Stack.of(this).formatArn({
            service: "execute-api",
            resource: wsApi.apiId,
            resourceName: `${stage}/${route}`
          })
        });
      });
    };

    grantInvoke(wsRelay, ["$connect", "$disconnect", "$default", "register", "state_update", "device_upsert", "list_devices", "delete_device", "keepalive"], "WsRelay");
    grantInvoke(adminLambda, [
      "admin_create_client",
      "admin_list_clients",
      "admin_revoke_client",
      "admin_update_client",
      "admin_delete_client",
      "admin_add_user_to_client",
      "admin_remove_user_from_client",
      "admin_list_client_users"
    ], "Admin");

    wsApi.grantManageConnections(smartHome);
    wsApi.grantManageConnections(wsRelay);
    wsApi.grantManageConnections(adminLambda);

    const wsMgmtEndpoint = `https://${wsApi.apiId}.execute-api.${cdk.Stack.of(this).region}.${cdk.Stack.of(this).urlSuffix}/${wsStage.stageName}`;
    smartHome.addEnvironment("WS_MGMT_ENDPOINT", wsMgmtEndpoint);
    wsRelay.addEnvironment("WS_MGMT_ENDPOINT", wsMgmtEndpoint);
    adminLambda.addEnvironment("WS_MGMT_ENDPOINT", wsMgmtEndpoint);

    smartHome.addPermission("AlexaSmartHomeInvoke", {
      principal: new iam.ServicePrincipal("alexa-connectedhome.amazon.com"),
      action: "lambda:InvokeFunction",
      eventSourceToken: alexaSkillId.valueAsString
    });

    new cdk.CfnOutput(this, "WebSocketUrl", { value: wsApi.apiEndpoint });
    new cdk.CfnOutput(this, "WebSocketMgmtUrl", { value: wsMgmtEndpoint });
    new cdk.CfnOutput(this, "UsersTableName", { value: usersTable.tableName });
    new cdk.CfnOutput(this, "DevicesTableName", { value: devicesTable.tableName });
  }
}
