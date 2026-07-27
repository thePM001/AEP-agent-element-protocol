#pragma once

#include <map>
#include <string>

namespace aep {

struct GatewayMeta {
  std::string agent_id = "lattice-gateway";
  std::string channel_id = "ch-outbound-gateway";
  std::string contract_id = "lattice-channel-default";
  std::string event_type = "LATTICE_GATEWAY_REQUEST";
  std::string session_id = "gateway-session";
  int trust_score = 750;
  std::string gateway = "http";
};

bool lattice_strict_enabled();
std::string resolve_socket_base();
std::string resolve_lattice_log_bin();
std::string build_lattice_frame_json(const std::string& event_json);
void lattice_dock_request(const std::string& socket_base,
                          const std::string& dock_port,
                          const std::string& event_json);
void lattice_gated_fetch_prepare(const std::string& url,
                                 const std::string& method,
                                 const GatewayMeta& meta,
                                 const std::string& socket_base = "");

}  // namespace aep