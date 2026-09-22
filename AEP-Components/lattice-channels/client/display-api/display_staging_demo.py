"""Display staging demonstration on a live Base Node.

Run from the repository root:

  AEP_BASE_NODE_BIN=/usr/local/bin/aep-base-node python3 AEP-Components/lattice-channels/client/display-api/display_staging_demo.py

The script builds a small data directory from the packaged display catalog, boots
a base node with the TLS transport, issues the client identity, then shows that
pre-staging holds several sectors of one source at once, that a granted client
can stage into a named sector, that each view projects its own sector and that
the staging survives a daemon restart. Every call goes over TLS JSON HTTP.

Environment:
  AEP_BASE_NODE_BIN names the base node binary. Default aep-base-node.
  AEP_DISPLAY_DEMO_DIR names the scratch directory. Default /tmp/aep-display-demo.
"""
import json
import os
import shutil
import subprocess
import sys
import time

REPO_ROOT = os.path.abspath(os.environ.get("AEP_REPO_ROOT", os.getcwd()))
BIN = os.environ.get("AEP_BASE_NODE_BIN", "aep-base-node")
ROOT = os.path.abspath(os.environ.get("AEP_DISPLAY_DEMO_DIR", "/tmp/aep-display-demo"))
DATA = os.path.join(ROOT, "data")
MAN = os.path.join(DATA, "ucb", "manifests")
SOCK = os.path.join(DATA, "sockets")
CATALOG = os.path.join(REPO_ROOT, "AEP-Components", "display-api")
sys.path.insert(0, os.path.join(REPO_ROOT, "AEP-Components", "lattice-channels", "client", "display-api"))
import display as d  # noqa: E402

PROOFS = []


def say(name, ok, detail=""):
    PROOFS.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (" | " + detail if detail else ""))


def env():
    e = dict(os.environ)
    e.update({
        "AEP_DATA": DATA,
        "AEP_SOCKET_BASE": SOCK,
        "AEP_LATTICE_YAML": os.path.join(DATA, "lattice.yaml"),
        "AEP_DISPLAY_GRANTS": os.path.join(DATA, "display-grants.gap"),
        "AEP_TASK_MANIFEST_DIR": MAN,
        "AEP_MANIFEST_RELOAD_INTERVAL_SECS": "0",
        "AEP_LATTICE_TRANSPORT": "tls",
        "AEP_LATTICE_TLS_BIND": "127.0.0.1",
        "AEP_LATTICE_STRICT": "1",
        "AEP_HUB_STRICT": "1",
        "AEP_BASE_NODE_BIN": BIN,
    })
    return e


def prepare():
    if os.path.exists(ROOT):
        shutil.rmtree(ROOT)
    os.makedirs(MAN)
    for name in ["lattice.yaml", "display-grants.gap", "source.alpha.json", "source.beta.json"]:
        shutil.copy(os.path.join(CATALOG, name), os.path.join(DATA, name))
    shutil.copy(os.path.join(CATALOG, "display-client.manifest.json"), os.path.join(MAN, "display-client.json"))


def boot():
    subprocess.run([BIN, "--provision-agent-sign-key", "--agent-id", "display-client", "--lattice-db", os.path.join(DATA, "action-lattice.db")],
                   env=env(), capture_output=True, text=True, timeout=120)
    log = open(os.path.join(ROOT, "daemon.log"), "a")
    proc = subprocess.Popen([BIN, "--daemon", "--socket-base", SOCK, "--lattice-db", os.path.join(DATA, "action-lattice.db"), "--internet-up"],
                            env=env(), cwd=REPO_ROOT, stdout=log, stderr=subprocess.STDOUT)
    for _ in range(40):
        if os.path.exists(os.path.join(SOCK, "display")):
            return proc
        time.sleep(0.5)
    proc.terminate()
    raise SystemExit("the daemon did not open the display socket")


def issue_identity():
    out = subprocess.run([BIN, "--issue-mesh-identity", "--agent-id", "display-client", "--lattice-db", os.path.join(DATA, "action-lattice.db")],
                         env=env(), capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise SystemExit("the identity command failed")
    ident = json.loads(out.stdout)
    e = env()
    e.update({
        "AEP_LATTICE_TLS_CERT": ident["cert_pem"],
        "AEP_LATTICE_TLS_KEY": ident["key_pem"],
        "AEP_LATTICE_TLS_CA": ident["ca_pem"],
    })
    os.environ.update(e)
    return e


def client():
    return d.DisplayClient(host="127.0.0.1", port=d.DISPLAY_TLS_PORT, agent_id=d.DEFAULT_AGENT_ID, seal_binary=BIN)


def main():
    if os.path.isdir(CATALOG) is False:
        raise SystemExit("run this from the repository root or set AEP_REPO_ROOT")
    prepare()
    proc = boot()
    issue_identity()
    c = client()
    catalog = c.list_catalog()
    time.sleep(0.2)
    say("catalog list over the JSON wire", sorted(catalog.get("views", [])) == ["view.alpha", "view.beta"], json.dumps(catalog, sort_keys=True))
    a1 = c.project("view.alpha")
    time.sleep(0.2)
    b1 = c.project("view.beta")
    time.sleep(0.2)
    say("two sectors of one source are staged at boot", a1 == {"label": "one"} and b1 == {"label": "two"},
        "view.alpha=" + json.dumps(a1) + " view.beta=" + json.dumps(b1))
    c.ingest("view.alpha", "source.alpha", "sector.one", {"section": "orders", "rows": 3})
    time.sleep(0.2)
    c.ingest("view.beta", "source.alpha", "sector.two", {"section": "stock", "rows": 5})
    time.sleep(0.2)
    a2 = c.project("view.alpha")
    time.sleep(0.2)
    b2 = c.project("view.beta")
    time.sleep(0.2)
    say("a granted client stages two sections side by side", a2 == {"section": "orders", "rows": 3} and b2 == {"section": "stock", "rows": 5},
        "view.alpha=" + json.dumps(a2) + " view.beta=" + json.dumps(b2))
    staged = sorted(os.listdir(os.path.join(DATA, "display-staging")))
    say("staging files sit under the AEP data dir", staged == ["source.alpha__sector.one.json", "source.alpha__sector.two.json"], ",".join(staged))
    proc.terminate()
    proc.wait(timeout=20)
    time.sleep(1)
    proc = boot()
    c2 = client()
    a3 = c2.project("view.alpha")
    time.sleep(0.2)
    b3 = c2.project("view.beta")
    time.sleep(0.2)
    say("staging survives a daemon restart", a3 == a2 and b3 == b2, "view.alpha=" + json.dumps(a3) + " view.beta=" + json.dumps(b3))
    proc.terminate()
    proc.wait(timeout=20)
    bad = [name for name, ok in PROOFS if not ok]
    print("checks passed: " + str(len(PROOFS) - len(bad)) + " of " + str(len(PROOFS)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
