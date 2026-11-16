#!/usr/bin/env python3
"""Redeploy the existing COINOP Vercel project from the current repo tree.

Redeploy ONLY: no project creation, no env changes. Uses the
custom.vercel-api connector's dynamic_credentials surrogate so the real
token never appears in this process.
"""
import hashlib, json, os, sys, time, urllib.request, urllib.error

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

BASE = "https://api.vercel.com"
TEAM = "team_dV7kemCtUn8HYsuEMLEk4wKH"
PROJECT = "prj_A4PVIDmf4SYkaESgFPHdJ1nbAKVO"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {"node_modules", ".next", ".git", ".data", "contracts", "test", "scripts", ".github"}
SKIP_EXT = {".map"}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("redirect refused")


opener = urllib.request.build_opener(urllib.request.ProxyHandler(urllib.request.getproxies()), NoRedirect)


def api(method, path, json_body=None, raw=None, headers=None):
    url = BASE + path + ("&" if "?" in path else "?") + "teamId=" + TEAM
    req = urllib.request.Request(url, method=method)
    add_surrogate_to_request(req, "custom.vercel-api", allowed_hosts=["api.vercel.com"])
    data = raw
    if json_body is not None:
        data = json.dumps(json_body).encode()
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with opener.open(req, data=data, timeout=120) as resp:
            body = resp.read()
            return resp.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"raw": body[:400]}


def collect():
    out = []
    for dp, dns, fns in os.walk(REPO):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for f in fns:
            if os.path.splitext(f)[1] in SKIP_EXT:
                continue
            if f.startswith(".env"):
                # Local env files must never ship: Next.js loads .env.local
                # at runtime on Vercel and its localhost values override the
                # production defaults (this poisoned Bazaar discovery).
                continue
            out.append(os.path.relpath(os.path.join(dp, f), REPO))
    return sorted(out)


def main():
    st, me = api("GET", "/v2/user")
    print("token check:", st)
    if st != 200:
        print(me); sys.exit(1)
    files = collect()
    manifest = []
    for rel in files:
        data = open(os.path.join(REPO, rel), "rb").read()
        sha = hashlib.sha1(data).hexdigest()
        st, res = api("POST", "/v2/now/files", raw=data,
                      headers={"x-vercel-digest": sha, "Content-Type": "application/octet-stream"})
        if st not in (200, 201):
            print("upload failed", rel, st, res); sys.exit(1)
        manifest.append({"file": rel.replace(os.sep, "/"), "sha": sha, "size": len(data)})
    print("uploaded", len(manifest), "files")
    st, dep = api("POST", "/v13/now/deployments", json_body={
        "name": "coinop", "project": PROJECT, "files": manifest, "target": "production",
        "projectSettings": {"framework": "nextjs"},
    })
    print("create deployment:", st)
    if st not in (200, 201):
        print(dep); sys.exit(1)
    did, url = dep.get("id"), dep.get("url")
    print("deployment:", did, "| url:", url)
    for _ in range(60):
        time.sleep(10)
        st, d = api("GET", f"/v13/now/deployments/{did}")
        state = d.get("readyState") or d.get("status")
        print("state:", state)
        if state in ("READY", "ERROR", "CANCELED"):
            if state != "READY":
                print(d); sys.exit(1)
            break
    print("READY https://coinop-one.vercel.app")


if __name__ == "__main__":
    main()
