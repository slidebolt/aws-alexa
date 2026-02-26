export const RELAY_ACTIONS = Object.freeze([
  "register",
  "state_update",
  "device_upsert",
  "list_devices",
  "delete_device",
  "device_delete",
  "keepalive"
]);

export const ADMIN_ACTIONS = Object.freeze([
  "admin_create_client",
  "admin_list_clients",
  "admin_revoke_client",
  "admin_update_client",
  "admin_delete_client",
  "admin_add_user_to_client",
  "admin_remove_user_from_client",
  "admin_list_client_users"
]);
