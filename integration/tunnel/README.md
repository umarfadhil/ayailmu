# Temporary synthetic Mac test route

This prepares a test route; it does **not** deploy a real-user backend. No script here automatically changes auth, opens a public tunnel, buys a plan, creates tunnel credentials, installs a service or changes firewall/router rules. Public exposure and auth/issuer restarts require a separate action-time approval.

## What is implemented

- `backend-umar/cmd/lab-router`: loopback-only router, maximum lifetime 30 minutes, fixed loopback API/auth upstreams, bounded bodies/concurrency and timeouts. No request/body/token logging.
- `tunnel_plan.py`: validates a canonical HTTPS origin, exact tester IPv4 `/32` or IPv6 `/128` addresses and a lifetime of 1–1800 seconds; prints the exact commands/configuration without executing them.
- `bounded_agent.py`: bounds one foreground child process. Deadline or Ctrl+C terminates only its owned process group; it never targets existing agents by name.
- `ngrok-agent.override.yaml`: merges after the existing ngrok configuration, retains existing credentials and uses private management port `127.0.0.1:4042`. Agent inspection is disabled by the generated command. Separately verify that the account's cloud Full Capture is off before exposure; the CLI flag does not establish the cloud setting.
- `gotrue.override.yaml`: derives external URL and JWT issuer from the same public origin, disables signup and uses the remote lab callback scheme. It preserves keys, databases, volumes and loopback bindings.
- `-Pumar.syncLab.publicOrigin=https://…`: configures both Android clients. Each exact remote origin has its own ID `id.petalytix.ayailmu.synclab.remote.r<SHA256-of-origin>`. Android therefore isolates the entire Room/settings/journal/Keystore sandbox when changing hosts. The same origin retains its identity on rebuild; the local `.synclab` ID is unchanged. No option enables this integration in ordinary demo/prod builds. Google stays disabled.

The earlier shared `.synclab.remote` installation is deliberately not migrated or deleted. Rebuilds for another origin must not inherit its credentials or pending answers. Preserve that installation for any separately approved recovery. Changing an environment's data/keys while keeping the same origin is a separate lifecycle problem, not solved by package names.

An empty Android property retains API `http://127.0.0.1:8187`, auth/issuer `http://127.0.0.1:8287` and the existing local application ID. Both build-time and runtime validation reject credentials, HTTP public origins, noncanonical host/port spelling, paths, query strings and fragments.

## Exposure proposed for approval

One explicitly approved **ngrok HTTPS origin** forwards to **`127.0.0.1:8188`**. The router permits only:

| Upstream | Routes/methods |
| --- | --- |
| API `8187` | GET `/healthz`; GET/POST `/v1/account` and `/v1/learners`; GET `/v1/packs`; POST `/v1/learners/{UUID}/consent`; GET/POST `/v1/learners/{UUID}/events` |
| GoTrue `8287` | POST `/token` with password or refresh-token grant; POST `/verify`, `/recover`, `/resend`; POST `/logout?scope=local`; GET/PUT `/user` |

Admin, signup, settings, metrics, readiness, public JWKS, OAuth/Google and unknown routes/methods are denied. Duplicate/unsupported query parameters and noncanonical/escaped paths are denied. Auth/ownership checks remain with GoTrue and the API. The local router is **not** a replacement for the ngrok tester-IP restriction.

Keep PostgreSQL `6586`, auth database `5432`, Mailpit UI `8387`/SMTP `1025`, template HTTP and preserved Keycloak `8286` private. Do not reuse, stop or reconfigure existing Expo tunnels on `8085`/`8088`. Do not use Basic Auth on the same Authorization header as the app's bearer token.

## Safe preparation (no public exposure)

Run from the repository root, with the existing Go/JDK/SDK environment:

```sh
mkdir -p integration/.local/bin
cd backend-umar
go build -o ../integration/.local/bin/umar-lab-router ./cmd/lab-router
cd ..
python3 -m unittest discover -s integration/tunnel -p 'test_*.py'
```

Create a reviewable plan using the approved hostname and actual tester egress addresses:

```sh
python3 integration/tunnel/tunnel_plan.py \
  --origin https://APPROVED-HOSTNAME \
  --allow-cidr TESTER-EGRESS-IP/32 \
  --seconds 1800
```

The uppercase placeholders deliberately fail validation. A plan does not reserve an endpoint or confirm ngrok account capacity, domain ownership or IP-policy entitlement. If existing account capacity cannot support this isolated endpoint, pause; do not purchase a plan, interfere with Expo or drop access controls.

## Only after action-time approval

Approval must cover the provider/hostname, IP allowlist, 30-minute maximum, routes above, ngrok's TLS termination, existing credential reuse, and the brief isolated API/auth restart needed for the issuer. Bootstrap only fabricated adult test accounts locally beforehand; Mailpit remains private and public signup remains blocked. Never use real learner/account data.

1. Record the current lab process/configuration and confirm no test runner is using it. Preserve all volumes, keys and old data. Do not use broad `pkill`, `docker compose down -v`, migrations to another app's DB or credential rotation.
2. Export the planner's exact `compose_env` values: `UMAR_PUBLIC_ORIGIN` and `UMAR_REMOTE_CALLBACK`. The callback is derived from the origin-specific application ID, not the older shared remote scheme. Do **not** commit a live URL/account configuration. Validate the origin with the planner before applying it.
3. Apply only the isolated GoTrue service override:

   ```sh
   docker compose -f integration/gotrue.compose.yaml \
     -f integration/tunnel/gotrue.override.yaml up -d gotrue
   ```

4. Stop only the recorded local Umar API process and restart with the existing launcher. An explicit issuer conflicting with the public origin fails closed:

   ```sh
   env -u UMAR_OIDC_ISSUER sh integration/run-gotrue-api.sh
   ```

   The launcher reads existing private DB/key configuration; no new credentials are created. It aligns `UMAR_OIDC_ISSUER` with `UMAR_PUBLIC_ORIGIN`. JWKS can remain private at `http://127.0.0.1:8287/.well-known/jwks.json`; signing keys do not change. The API itself remains loopback-bound.
5. Start the planner's **router** command in one foreground terminal. In another, run its **bounded_ngrok** command, not an unbounded agent. Its command includes the IP restriction, `--inspect=false`, `--log=false` and the separate management-port override. Record only this new agent's PID/URL. Never print credentials or capture request payloads.
6. Verify health from an allowed address, denial from a non-allowed address, and denial of `/admin`, `/signup`, `/settings` and unknown routes before sharing the test origin. Stop immediately if the restrictions cannot be verified. Build the remote APK using the **same exact origin**:

   ```sh
   sh android/gradlew -p android :app:assembleSyncLabDebug \
     -Pumar.syncLab.publicOrigin="$UMAR_PUBLIC_ORIGIN"
   ```

7. Use the separate remote test app for a fabricated-account device smoke test: sign-in/refresh, OTP recovery, offline answer/retry, learner isolation, logout and restart. Do not enable Google. Device/network/tunnel checks remain pending until this approved execution actually occurs.

## Stop and rollback

Ctrl+C the bounded agent; its deadline also sends TERM and then KILL if needed to **its owned group only**. The router independently shuts down at its deadline (at most 30 minutes, plus a short shutdown grace). A timeout exit `124` is intentional. Verify the new endpoint is gone; leave existing Expo agents intact.

Stop only the recorded temporary API/router processes. Unset `UMAR_PUBLIC_ORIGIN`/`UMAR_OIDC_ISSUER`/`UMAR_REMOTE_CALLBACK`, apply the original GoTrue Compose file to the `gotrue` service without the override, and restart the original local API launcher. This restores local issuer/site/signup configuration, retaining all volumes and keys. Recheck loopback health. A changed issuer is part of account identity: use new fabricated bindings, preserve previous profiles, and never silently migrate, delete or relabel old history. Remove any remote lab test installation separately only with the device owner's consent.

The ordinary app/content graph, native mastery, synthetic-only API/schema restrictions and per-owner isolation are unchanged. This packet supplies no path to enable real-user collection.
