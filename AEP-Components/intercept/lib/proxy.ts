export type InterceptHooks = {
  /** Return false to deny the method call. */
  beforeCall?: (prop: string | symbol, args: unknown[]) => boolean | void;
  afterCall?: (prop: string | symbol, args: unknown[], result: unknown) => void;
  onDenied?: (prop: string | symbol, args: unknown[]) => void;
  audit?: (event: {
    phase: "get" | "set" | "call" | "deny";
    prop: string | symbol;
    args?: unknown[];
  }) => void;
};

export function createInterceptProxy(
  target: object,
  hooks: InterceptHooks = {}
): object {
  return new Proxy(target, {
    get(t, prop, recv) {
      hooks.audit?.({ phase: "get", prop });
      const v = Reflect.get(t, prop, recv);
      if (typeof v === "function") {
        return function (this: unknown, ...args: unknown[]) {
          const allow = hooks.beforeCall?.(prop, args);
          if (allow === false) {
            hooks.audit?.({ phase: "deny", prop, args });
            hooks.onDenied?.(prop, args);
            throw new Error(
              `intercept denied call to ${String(prop)} (policy hook)`
            );
          }
          const result = v.apply(this === recv ? t : this, args);
          hooks.afterCall?.(prop, args, result);
          hooks.audit?.({ phase: "call", prop, args });
          return result;
        };
      }
      return v;
    },
    set(t, prop, value, recv) {
      hooks.audit?.({ phase: "set", prop });
      return Reflect.set(t, prop, value, recv);
    },
  });
}
