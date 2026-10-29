import { useSyncExternalStore } from "react";
let reachable = false;
const listeners = new Set<() => void>();
export function setReachable(value: boolean) {
  if (value !== reachable) {
    reachable = value;
    listeners.forEach((fn) => fn());
  }
}
export function isReachable() {
  return reachable;
}
export function useOnline() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => reachable,
  );
}
