# Egress address check

One address check for every outbound request of AEP. The Base Node gateway request, the UCB egress proxy and the JavaScript lattice helpers all decide with this component, so an address that one of them refuses is refused by all of them.

| Part | Path |
| --- | --- |
| Rust crate `aep-egress-address` | `crate/` |
| JavaScript module | `lib/egress-address.mjs` with the types in `lib/egress-address.d.mts` |
| Shared vectors | `vectors/egress-address-vectors.json` |
| Vector run in node | `node AEP-Components/egress-address/bin/run-vectors.mjs` |

## Classes

| Class | Ranges | Allowed |
| --- | --- | --- |
| public | everything not listed below (in IPv6 only inside 2000::/3) | always |
| loopback | 127.0.0.0/8, ::1, localhost names | with `AEP_LATTICE_ALLOW_LOOPBACK=1` |
| unspecified | 0.0.0.0/8, :: | with `AEP_LATTICE_ALLOW_LOOPBACK=1` |
| private | 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7, fec0::/10 | with `AEP_LATTICE_ALLOW_PRIVATE=1` |
| shared | 100.64.0.0/10 | with `AEP_LATTICE_ALLOW_PRIVATE=1` |
| link_local | 169.254.0.0/16, fe80::/10, metadata, `.internal` and `.local` names | with `AEP_LATTICE_ALLOW_PRIVATE=1` |
| reserved | 192.0.0.0/24, 192.0.2.0/24, 192.88.99.0/24, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/4, 240.0.0.0/4, ::/96, ::ffff:0:0:0/96, 64:ff9b::/96, 64:ff9b:1::/48, 100::/64, 2001::/23, 2001:db8::/32, 2002::/16, 3fff::/20, 5f00::/16, ff00::/8 and IPv6 outside 2000::/3 | never |

A mapped address ::ffff:a.b.c.d takes the class of its IPv4 address. Every other IPv6 transition range is reserved, so a NAT64, 6to4, Teredo or IPv4 compatible address never reaches an IPv4 host that the IPv4 rows refuse. The UCB egress proxy admits public addresses only, whatever the two flags say.

## Use

1. `check_url` (`checkUrl` in JavaScript) reads the URL without a lookup: only http and https, no user info, an address literal against the range list and the reserved names. The URL parser reads every IPv4 spelling of the WHATWG URL standard, so 0x7f.1, 2130706433 and 0177.0.0.1 reach the list as 127.0.0.1.
2. `resolve_checked` resolves the host once and checks every address of the answer. One refused address refuses the whole answer. An async caller resolves on its own runtime and passes the answer to `check_resolved`.
3. The caller connects only to the returned addresses, so a second answer of the name server cannot move the request.
4. `read_body_bounded` reads a reply and stops one byte past the cap.

## Vectors

The vector file holds address rows with their class and their answer under three policies. It also holds URL rows with their verdict under the default policy. No URL row needs a lookup. `cargo test -p aep-egress-address` and the node vector run read the same file. The gated fetch crate, the UCB egress module and both JavaScript lattice helpers run the URL rows too.

A new range goes into `V4_RANGES` or `V6_RANGES` of the crate, the same table in `egress-address.mjs` and a row of the vector file in one change.
