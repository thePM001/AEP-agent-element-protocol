#include "aep/lattice_client.hpp"
#include <iostream>

int main() {
  try {
    const std::string event =
        R"({"agent_id":"sdk-smoke","channel_id":"ch-smoke","event_type":"SDK_SMOKE","payload":{}})";
    const std::string out = aep::build_lattice_frame_json(event);
    std::cout << out.substr(0, 80) << "...\n";
  } catch (const std::exception& e) {
    std::cerr << "skip: " << e.what() << "\n";
  }
  return 0;
}