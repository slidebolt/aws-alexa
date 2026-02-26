import test from "node:test";
import assert from "node:assert/strict";
import {
  pk,
  sk,
  clientMetadataKey,
  userMetadataKey,
  connSessionKey,
  clientDeviceKey,
  clientDeletedDeviceKey
} from "../../shared/dynamo/keys.mjs";

test("key builders produce expected single-table prefixes", () => {
  assert.equal(pk.client("c1"), "CLIENT#c1");
  assert.equal(pk.user("u1"), "USER#u1");
  assert.equal(pk.conn("abc"), "CONN#abc");
  assert.equal(sk.metadata(), "METADATA");
  assert.equal(sk.session(), "SESSION");
  assert.equal(sk.conn(), "CONN");
  assert.equal(sk.device("lamp-1"), "DEVICE#lamp-1");
  assert.equal(sk.deletedDevice("lamp-1"), "DELETED#lamp-1");
});

test("composite key helpers return pk/sk objects", () => {
  assert.deepEqual(clientMetadataKey("c1"), { pk: "CLIENT#c1", sk: "METADATA" });
  assert.deepEqual(userMetadataKey("u1"), { pk: "USER#u1", sk: "METADATA" });
  assert.deepEqual(connSessionKey("cx"), { pk: "CONN#cx", sk: "SESSION" });
  assert.deepEqual(clientDeviceKey("c1", "d1"), { pk: "CLIENT#c1", sk: "DEVICE#d1" });
  assert.deepEqual(clientDeletedDeviceKey("c1", "d1"), { pk: "CLIENT#c1", sk: "DELETED#d1" });
});

