#!/usr/bin/env python3
"""Print a secret-free exposure plan. This module never starts a tunnel or edits services."""
import argparse
import hashlib
import ipaddress
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit


def canonical_origin(origin):
    try:
        uri = urlsplit(origin)
        host = uri.hostname
        port = uri.port
        authority = ("[" + host + "]" if host and ":" in host else host or "")
        if port is not None:
            authority += ":" + str(port)
        valid = (
            origin.startswith("https://") and all(33 <= ord(c) <= 126 for c in origin)
            and host and uri.netloc == authority and not uri.path
            and "?" not in origin and "#" not in origin
            and (port is None or 1 <= port <= 65535)
        )
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("A canonical HTTPS origin without credentials, path, query or fragment is required")
    return origin


def build_plan(origin, allow_cidrs, seconds=1800):
    origin = canonical_origin(origin)
    application_id = "id.petalytix.ayailmu.synclab.remote.r" + hashlib.sha256(origin.encode("ascii")).hexdigest()
    callback = application_id + "://auth-callback"
    if type(seconds) is not int or not 1 <= seconds <= 1800:
        raise ValueError("Lifetime must be between one and 1800 seconds")
    if not allow_cidrs:
        raise ValueError("At least one exact tester egress address is required")
    cidrs = []
    for value in allow_cidrs:
        network = ipaddress.ip_network(value, strict=True)
        if network.prefixlen != network.max_prefixlen:
            raise ValueError("Use exact tester addresses: IPv4 /32 or IPv6 /128")
        cidrs.append(str(network))
    directory = Path(__file__).resolve().parent
    existing_config = Path.home() / "Library/Application Support/ngrok/ngrok.yml"
    ngrok = ["ngrok", "http", "http://127.0.0.1:8188", "--url=" + origin,
             "--inspect=false", "--log=false", "--config", str(existing_config),
             "--config", str(directory / "ngrok-agent.override.yaml")]
    ngrok.extend("--cidr-allow=" + value for value in sorted(set(cidrs)))
    return {
        "requires_action_time_approval": True,
        "public_origin": origin,
        "android_application_id": application_id,
        "compose_env": {"UMAR_PUBLIC_ORIGIN": origin, "UMAR_REMOTE_CALLBACK": callback},
        "seconds": seconds,
        "api_env": {"UMAR_PUBLIC_ORIGIN": origin, "UMAR_OIDC_ISSUER": origin,
                    "UMAR_OIDC_JWKS_URL": "http://127.0.0.1:8287/.well-known/jwks.json"},
        "auth_env": {"API_EXTERNAL_URL": origin, "GOTRUE_JWT_ISSUER": origin,
                     "GOTRUE_SITE_URL": callback, "GOTRUE_URI_ALLOW_LIST": callback,
                     "GOTRUE_DISABLE_SIGNUP": "true"},
        "android_property": "-Pumar.syncLab.publicOrigin=" + origin,
        "router": ["integration/.local/bin/umar-lab-router", "-listen=127.0.0.1:8188",
                   "-api=http://127.0.0.1:8187", "-auth=http://127.0.0.1:8287",
                   "-duration=" + str(seconds) + "s"],
        "ngrok": ngrok,
        "bounded_ngrok": [sys.executable, str(directory / "bounded_agent.py"),
                          "--seconds", str(seconds), "--", *ngrok],
        "stop": "Ctrl+C the bounded agent (only its owned process group is stopped); router also expires automatically",
        "private": ["PostgreSQL", "Mailpit", "GoTrue admin/signup/settings/metrics", "Keycloak"],
        "warnings": ["No endpoint created by this planner", "Account capacity and policy entitlement require verification; do not buy or drop restrictions", "Changing issuer creates another account namespace; preserve old data and use fabricated test bindings"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--allow-cidr", action="append", required=True)
    parser.add_argument("--seconds", type=int, default=1800)
    args = parser.parse_args()
    try:
        plan = build_plan(args.origin, args.allow_cidr, args.seconds)
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps(plan, indent=2))


if __name__ == "__main__":
    main()
