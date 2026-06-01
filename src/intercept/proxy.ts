export function createInterceptProxy(target: object): object {
  return new Proxy(target, {});
}
