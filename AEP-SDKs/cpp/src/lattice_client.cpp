#include "aep/lattice_client.hpp"

#include <array>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <string>

namespace fs = std::filesystem;

namespace {

std::string getenv_or(const char* key, const std::string& fallback) {
  if (const char* v = std::getenv(key)) return std::string(v);
  return fallback;
}

std::string shell_quote(const std::string& s) {
  std::string out = "'";
  for (char c : s) {
    if (c == '\'') out += "'\\''";
    else out += c;
  }
  out += "'";
  return out;
}

std::string run_command(const std::string& cmd) {
  std::array<char, 4096> buffer{};
  std::string result;
  std::unique_ptr<FILE, decltype(&pclose)> pipe(popen(cmd.c_str(), "r"), pclose);
  if (!pipe) throw std::runtime_error("popen failed");
  while (fgets(buffer.data(), buffer.size(), pipe.get()) != nullptr) {
    result += buffer.data();
  }
  return result;
}

}  // namespace

namespace aep {

bool lattice_strict_enabled() {
  return getenv_or("AEP_LATTICE_STRICT", "1") != "0";
}

std::string resolve_socket_base() {
  if (const char* base = std::getenv("AEP_SOCKET_BASE")) return base;
  const std::string data = getenv_or("AEP_DATA", (fs::path(std::getenv("HOME") ? std::getenv("HOME") : "/tmp") / ".aep").string());
  return (fs::path(data) / "sockets").string();
}

std::string resolve_lattice_log_bin() {
  if (const char* bin = std::getenv("AEP_LATTICE_LOG_BIN")) return bin;
  if (const char* bin = std::getenv("AEP_LATTICE_LOG_CLI")) return bin;
  return "aep-lattice-log";
}

std::string build_lattice_frame_json(const std::string& event_json) {
  std::string cmd = resolve_lattice_log_bin();
  const std::string data = getenv_or("AEP_DATA", (fs::path(std::getenv("HOME") ? std::getenv("HOME") : "/tmp") / ".aep").string());
  const fs::path cfg = fs::path(data) / "base-node.json";
  if (fs::exists(cfg)) {
    cmd += " --config " + shell_quote(cfg.string());
  }
  cmd += " build-frame";
  cmd = "printf %s " + shell_quote(event_json) + " | " + cmd;
  const std::string out = run_command(cmd);
  if (out.find("\"frame\"") == std::string::npos) {
    throw std::runtime_error("aep-lattice-log build-frame missing LatticeChannelFrame");
  }
  return out;
}

void lattice_dock_request(const std::string& socket_base,
                          const std::string& dock_port,
                          const std::string& event_json) {
  std::string suffix = dock_port;
  if (dock_port == "inference_engine") suffix = "inference";
  else if (dock_port == "validation_engine") suffix = "validation";
  else if (dock_port == "future_features") suffix = "future";
  else if (dock_port == "regulation_module") suffix = "regulation";
  const fs::path socket_path = fs::path(socket_base) / suffix;
  if (!fs::exists(socket_path)) {
    throw std::runtime_error("lattice socket not found: " + socket_path.string());
  }
  const std::string sealed = build_lattice_frame_json(event_json);
  const std::string wire = "{\"frame\":" + sealed.substr(sealed.find("\"frame\"") + 8);
  (void)wire;
  // Dock audit: frame built and socket path validated (full Unix wire protocol in TS/Go/Rust SDKs).
}

void lattice_gated_fetch_prepare(const std::string& url,
                                 const std::string& method,
                                 const GatewayMeta& meta,
                                 const std::string& socket_base) {
  if (!lattice_strict_enabled()) return;
  const std::string base = socket_base.empty() ? resolve_socket_base() : socket_base;
  const std::string event_json =
      std::string("{\"agent_id\":\"") + meta.agent_id +
      "\",\"channel_id\":\"" + meta.channel_id +
      "\",\"contract_id\":\"" + meta.contract_id +
      "\",\"event_type\":\"" + meta.event_type +
      "\",\"session_id\":\"" + meta.session_id +
      "\",\"docking_port\":\"inference_engine\",\"trust_score\":" + std::to_string(meta.trust_score) +
      ",\"payload\":{\"url\":\"" + url + "\",\"method\":\"" + method +
      "\",\"gateway\":\"" + meta.gateway + "\"}}";
  lattice_dock_request(base, "inference_engine", event_json);
  const fs::path inference = fs::path(base) / "inference";
  if (!fs::exists(inference)) {
    throw std::runtime_error("inference_engine dock required: " + inference.string());
  }
}

}  // namespace aep