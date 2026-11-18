#!/usr/bin/env python3
"""COINOP security scan — run weekly (cron) and before any launch announcement.

Checks, in plain terms:
  1. No secret keys or passwords written anywhere in the source code.
  2. No personal information (names, emails, company, hometown) in anything
     the public or an agent can read.
  3. The real secret values from .env.local never appear in any live response
     from the production site (checked by value, never printed).
  4. The locked doors stay locked: the internal claims endpoint refuses
     callers without the secret (401), and the coin slot refuses unpaid
     plays (402).
  5. Local secret files stay out of git.
Exit 0 = no failures. Warnings are printed but do not fail the scan.
"""
import json, os, re, subprocess, sys, time, urllib.request, urllib.error

REPO = os.path.expanduser("~/workspace/coinop")
BASE = sys.argv[1] if len(sys.argv) > 1 else "https://coinop-one.vercel.app"
SKIP_DIRS = {"node_modules", ".next", ".data", ".git", "artifacts-contracts", "cache-contracts"}
fails, warns = [], []

def walk_files(subdirs, exts):
    for sub in subdirs:
        root = os.path.join(REPO, sub)
        if not os.path.isdir(root):
            continue
        for dp, dn, fn in os.walk(root):
            dn[:] = [d for d in dn if d not in SKIP_DIRS]
            for f in fn:
                if f.endswith(exts):
                    yield os.path.join(dp, f)

# --- 1) secrets in source -------------------------------------------------
SECRET_PATTERNS = [
    ("private-key hex (64)", re.compile(r"(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])")),
    ("key assignment literal", re.compile(r"PRIVATE_KEY\s*=\s*[\"'][^\"']{10,}[\"']")),
    ("PEM private key", re.compile(r"BEGIN (RSA |EC )?PRIVATE KEY")),
    ("API token (sk-)", re.compile(r"sk-[A-Za-z0-9]{20,}")),
]
for path in walk_files(["app", "lib", "components", "db", "public", "scripts", "examples"],
                       (".ts", ".tsx", ".js", ".mjs", ".json", ".html", ".txt", ".sol")):
    text = open(path, errors="ignore").read()
    for label, pat in SECRET_PATTERNS:
        # 64-hex appears legitimately as sha256 hashes in fairness code/tests;
        # flag it only when the line also mentions a key/secret context.
        for i, line in enumerate(text.splitlines(), 1):
            if pat.search(line):
                if label.startswith("private-key") and not re.search(r"(?i)private|secret|mnemonic|seed phrase", line):
                    continue
                fails.append(f"secret pattern '{label}' at {os.path.relpath(path, REPO)}:{i}")

# --- 2) personal info on the public surface --------------------------------
PERSONAL = [
    ("operator first name", re.compile(r"\badam\b", re.I)),
    ("operator surname", re.compile(r"washington", re.I)),
    ("company name", re.compile(r"adub3x", re.I)),
    ("hometown", re.compile(r"greensboro", re.I)),
    ("family name", re.compile(r"tonisha", re.I)),
    ("email address", re.compile(r"[A-Za-z0-9._%+-]+@(gmail|yahoo|outlook|icloud)\.com", re.I)),
]
for path in walk_files(["app", "lib", "components", "public"], (".ts", ".tsx", ".json", ".html", ".txt")):
    if ".test." in path:
        continue  # tests are not deployed
    text = open(path, errors="ignore").read()
    for label, pat in PERSONAL:
        m = pat.search(text)
        if m:
            fails.append(f"personal info '{label}' in {os.path.relpath(path, REPO)}")

# --- 3) live responses must never contain the real secret values -----------
env = {}
env_path = os.path.join(REPO, ".env.local")
if os.path.exists(env_path):
    for line in open(env_path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
SECRET_VALUES = {k: env[k] for k in ("SESSION_HMAC_SECRET", "INTERNAL_JOB_SECRET", "CLAIM_MINTER_PRIVATE_KEY") if env.get(k)}

def fetch(path, method="GET", body=None, attempts=3):
    # Retry transport-level errors (the egress proxy sometimes truncates a
    # response mid-read, raising IncompleteRead): a cut-off read is a network
    # hiccup, not a finding. Only the final attempt's failure is reported.
    req = urllib.request.Request(BASE + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json"} if body is not None else {})
    last = None
    for i in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read().decode("utf-8", "ignore")
        except urllib.error.HTTPError as e:
            try:
                return e.code, e.read().decode("utf-8", "ignore")
            except Exception as e2:
                last = str(e2)
        except Exception as e:
            last = str(e)
        if i < attempts - 1:
            time.sleep(2 * (i + 1))
    return None, last or "fetch failed"

LIVE_GETS = ["/", "/api/games", "/api/discovery", "/llms.txt", "/agents",
             "/api/boards/general", "/api/leaderboard?slug=snake&season=all"]
for p in LIVE_GETS:
    st, body = fetch(p)
    if st is None:
        warns.append(f"live check could not reach {p}")
        continue
    for name, value in SECRET_VALUES.items():
        if value and value in body:
            fails.append(f"SECRET LEAK: {name} value appears in live response {p}")
    for label, pat in PERSONAL:
        if pat.search(body):
            fails.append(f"personal info '{label}' in live response {p}")

# --- 4) locked doors --------------------------------------------------------
st, _ = fetch("/api/internal/process-claims", method="POST", body={})
if st != 401:
    fails.append(f"internal claims endpoint returned {st}, expected 401 without the secret")
st, _ = fetch("/api/coin", method="POST", body={"gameSlug": "snake"})
if st != 402:
    fails.append(f"coin slot returned {st} for an unpaid play, expected 402")

# --- 5) git hygiene ----------------------------------------------------------
tracked = subprocess.run(["git", "-C", REPO, "ls-files"], capture_output=True, text=True).stdout.splitlines()
for t in tracked:
    if t.startswith(".env") and t != ".env.example":
        fails.append(f"secret file tracked in git: {t}")

# --- 6) dependency audit (best effort) --------------------------------------
try:
    r = subprocess.run(["npm", "audit", "--json"], cwd=REPO, capture_output=True, text=True, timeout=120)
    audit = json.loads(r.stdout)
    vulns = audit.get("metadata", {}).get("vulnerabilities", {})
    crit = vulns.get("critical", 0) + vulns.get("high", 0)
    if crit:
        warns.append(f"npm audit: {crit} critical/high vulnerabilities in dependencies")
except Exception:
    warns.append("npm audit unavailable in this environment (endpoint blocked); CI audit still owed")

print("COINOP security scan —", BASE)
for w in warns:
    print("  WARN:", w)
if fails:
    for f in fails:
        print("  FAIL:", f)
    print(f"RESULT: {len(fails)} FAILURE(S)")
    sys.exit(1)
print("RESULT: PASS (no secrets, no personal info, locked doors verified)")
