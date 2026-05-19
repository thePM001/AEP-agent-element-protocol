#!/usr/bin/env python3
"""
AEP Policy Violation Reports API

Receives violation reports from agents and writes them to the
centralized policy-violations directory.

Endpoint:
  POST http://<HOST>:<PORT>/violation
  GET  http://<HOST>:<PORT>/health
  GET  http://<HOST>:<PORT>/stats

Run:
  python3 report-api.py [--port <PORT>] [--dir <REPORTS_DIR>]

Part of the Agent Control Hub - open source reference implementation.
Apache 2.0 License.
"""

import http.server
import json
import os
import sys
import time
import uuid
import argparse
from datetime import datetime, timezone


class ViolationReportHandler(http.server.BaseHTTPRequestHandler):
    reports_dir = "./violation-reports"
    violation_count = 0
    agent_registry = {}

    def do_POST(self):
        if self.path == "/violation":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length else b""
            try:
                report = json.loads(body) if body else {}
            except json.JSONDecodeError as e:
                self._respond(400, {"error": f"Invalid JSON: {e}"})
                return

            required = ["agent", "agent_id", "timestamp"]
            missing = [f for f in required if f not in report]
            if missing:
                self._respond(400, {"error": f"Missing required fields: {missing}"})
                return

            violations = report.get("violations", [])
            if not violations:
                self._respond(202, {"status": "no_violations", "count": 0})
                return

            for v in violations:
                if "type" not in v or "policy_ref" not in v:
                    self._respond(400, {
                        "error": "Each violation must have type and policy_ref"
                    })
                    return

            report_id = str(uuid.uuid4())[:8]
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            filename = f"{timestamp}-{report['agent']}-{report_id}.json"
            filepath = os.path.join(self.reports_dir, filename)

            report["_id"] = report_id
            report["_received_at"] = datetime.now(timezone.utc).isoformat()
            report["_file"] = filename

            os.makedirs(self.reports_dir, exist_ok=True)
            try:
                with open(filepath, "w") as f:
                    json.dump(report, f, indent=2)
            except OSError as e:
                self._respond(500, {"error": f"Write failed: {e}"})
                return

            agent = report["agent"]
            if agent not in self.agent_registry:
                self.agent_registry[agent] = {
                    "first_report": timestamp,
                    "total_violations": 0
                }
            self.agent_registry[agent]["total_violations"] += len(violations)
            type(self).violation_count += len(violations)

            self._respond(200, {
                "status": "reported",
                "report_id": report_id,
                "filename": filename,
                "violation_count": len(violations),
                "total_violations": type(self).violation_count
            })
        else:
            self._respond(404, {"error": "Not found. POST to /violation"})

    def do_GET(self):
        if self.path == "/health":
            self._respond(200, {
                "status": "ok",
                "service": "Policy Violation Reports API",
                "reports_dir": self.reports_dir,
                "total_violations_reported": type(self).violation_count,
                "agents_registered": len(self.agent_registry)
            })
        elif self.path == "/stats":
            self._respond(200, {
                "total_violations": type(self).violation_count,
                "agents": self.agent_registry,
                "reports_dir": self.reports_dir,
            })
        else:
            self._respond(404, {"error": "Not found. Try /health or /stats"})

    def _respond(self, status_code, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"[{datetime.now(timezone.utc).isoformat()}] {args[0]}", flush=True)


def main():
    parser = argparse.ArgumentParser(
        description="Policy Violation Reports API"
    )
    parser.add_argument(
        "--port", type=int, default=8420,
        help="Port to listen on (default: 8420)"
    )
    parser.add_argument(
        "--dir", type=str, default="./violation-reports",
        help="Directory for violation report files"
    )
    args = parser.parse_args()

    ViolationReportHandler.reports_dir = args.dir
    os.makedirs(args.dir, exist_ok=True)

    server = http.server.HTTPServer(
        ("127.0.0.1", args.port), ViolationReportHandler
    )
    print(f"Policy Violation Reports API listening on 127.0.0.1:{args.port}")
    print(f"Reports directory: {os.path.abspath(args.dir)}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
