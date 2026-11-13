# Lattice gated fetch

The kernel outbound request of the one granted gateway path. After dock allow, lattice-gated-fetch must not fall through to ordinary fetch: the dock executes the bound HTTP and returns `http`. Clients consume that answer.

## The gateway path

Base Node sends a request for an agent only for an admitted event on the action path `gateway:outbound_http` (`GATEWAY_ACTION_PATH`). `gateway_request_of` returns nothing for any other event, whatever fields it carries, so a `url` field of a write or a ping is data. On the gateway path the request comes from the payload: `url`, `method`, `headers` and `body` or `body_b64`. A gateway event without a url or with a body that does not decode closes the route wall.

`GatewayRoutes` is the operator route list. Base Node reads it from `gateway-routes.json` in its data folder or from the file that `AEP_GATEWAY_ROUTES` names. A route opens one scheme, host, port, path prefix and set of methods. A missing file is an empty list. An empty list refuses every request.

## The request

`execute_bound_http_after_allow_with_policy` blocks, so Base Node runs it on a thread of its own and never on the pulse or an async worker. It checks the URL and every address of the host with `aep-egress-address`, connects only to those addresses and follows no redirect. The connection gets 3 seconds, the whole request 8 seconds and the reply at most 8 MiB.

## The source gate

The binary `aep-lattice-gated-fetch` reads the Base Node docking module and the client twins in `lattice-channels/lib`. It fails when the dock no longer executes the bound request or when a twin calls an ordinary fetch after the dock answered.
