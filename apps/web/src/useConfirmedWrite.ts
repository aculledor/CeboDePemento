import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, write, ApiFailure, newOperationId } from "./api";
import { isReachable } from "./connectivity";
export function useConfirmedWrite<T, B>(
  path: string,
  method: "POST" | "PATCH",
  onSuccess: (value: T) => void | Promise<void>,
) {
  const pending = useRef<{ key: string; body: B } | null>(null),
    [uncertain, setUncertain] = useState(false);
  const mutation = useMutation({
    mutationFn: async (body: B): Promise<T> => {
      if (!isReachable()) throw new ApiFailure(503, "SERVER_UNAVAILABLE");
      if (
        pending.current &&
        JSON.stringify(pending.current.body) !== JSON.stringify(body)
      )
        throw new ApiFailure(409, "PENDING_OPERATION");
      pending.current ??= { key: newOperationId(), body };
      const state = await api<{ applied: boolean; result?: T }>(
        `/operations/${pending.current.key}`,
      );
      if (state.applied) return state.result!;
      return write<T>(path, pending.current.body, pending.current.key, method);
    },
    onSuccess: async (value) => {
      pending.current = null;
      setUncertain(false);
      await onSuccess(value);
    },
    onError: (error) => {
      const unknown = !(error instanceof ApiFailure) || error.status >= 500;
      setUncertain(unknown);
      if (
        !unknown &&
        !(error instanceof ApiFailure && error.code === "PENDING_OPERATION")
      )
        pending.current = null;
    },
  });
  return {
    ...mutation,
    uncertain,
    reconcile: () => {
      if (pending.current) mutation.mutate(pending.current.body);
    },
  };
}
