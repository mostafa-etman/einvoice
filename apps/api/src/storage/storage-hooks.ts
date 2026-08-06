/** Optional post-put hook so analytics can refresh storage_bytes without circular DI. */
export type StoragePutHook = (tenantId: string) => void | Promise<void>;

let putHook: StoragePutHook | undefined;

export function setStoragePutHook(hook: StoragePutHook | undefined) {
  putHook = hook;
}

export async function notifyStoragePut(tenantId: string): Promise<void> {
  if (!putHook) return;
  try {
    await putHook(tenantId);
  } catch {
    /* metering must not break storage */
  }
}
