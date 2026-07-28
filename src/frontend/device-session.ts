const DEVICE_STORAGE_KEY = "loglisted.anonymous-device.v1";

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function getOrCreateDeviceId(storage: Pick<Storage, "getItem" | "setItem">): string {
  const stored = storage.getItem(DEVICE_STORAGE_KEY);
  if (stored && isUuid(stored)) return stored;
  const created = crypto.randomUUID();
  storage.setItem(DEVICE_STORAGE_KEY, created);
  return created;
}
