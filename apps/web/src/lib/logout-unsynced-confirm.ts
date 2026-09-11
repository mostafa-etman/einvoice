export type LogoutUnsyncedConfirm = (unsyncedCount: number) => Promise<boolean>;

let handler: LogoutUnsyncedConfirm | null = null;

export function registerLogoutUnsyncedConfirm(next: LogoutUnsyncedConfirm): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export function confirmLogoutIfUnsynced(unsyncedCount: number): Promise<boolean> {
  if (handler) return handler(unsyncedCount);
  return Promise.resolve(false);
}
