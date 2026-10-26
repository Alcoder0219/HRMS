# MB360 biometric terminal → HRMS attendance

How the ZKTeco MB360 at the office gets its punches into the HRMS Attendance module, how to set it up, and how to tell whether it is working.

> **Status:** the HRMS side is built and tested against simulated device traffic. **No real MB360 has talked to it yet.** The device is not "connected" until the end-to-end test in [§6](#6-testing-the-connection) passes on the real terminal.

---

## 1. What the device is doing today

The device's Cloud Server Settings screen shows:

| Setting | Value |
|---|---|
| Server Mode | ADMS |
| Enable Domain Name | OFF |
| Server Address | `116.202.116.58` |
| Server Port | `8081` |
| Enable Proxy Server | OFF |
| HTTPS | OFF |

**`116.202.116.58:8081` is not this HRMS.** Checked on 26 Oct 2026 with unauthenticated requests only:

- It is live and serves a ZKTeco **"easy WDMS"** (easyTimePro) web application, with the title `easy WDMS` and a redirect to `/login/`.
- Reverse DNS is `ns99.gkums.com`. The address is in a Hetzner (Germany) range, so it is a hosted cloud attendance service run by a vendor or reseller.
- It exposes the WDMS REST API: `/api-token-auth/` answers 405 to GET, and `/iclock/api/transactions/` answers 401 "Authentication credentials were not provided".

So the MB360 is currently pushing every punch to a third-party WDMS cloud account. A ZKTeco terminal pushes to **one** ADMS server at a time. Changing the address to the HRMS **stops data reaching that WDMS account**.

**Find out before changing anything:** who owns that easy WDMS account, and whether anything else depends on it (reports, another payroll system, a vendor's support contract).

## 2. Choosing how punches reach the HRMS

The HRMS backend runs on Cloud Run (`asia-south1`), and the terminal is on the office LAN. ADMS is a polling HTTP protocol. The **device** makes short HTTP requests to the server, so no persistent listener or fixed inbound port is needed, which suits Cloud Run. But the device speaks plain HTTP with no credential, and Cloud Run only accepts HTTPS on 443.

| | A. Keep easy WDMS, HRMS pulls from it | **B. Office gateway → HRMS (recommended)** | C. Device → Cloud Run directly |
|---|---|---|---|
| Device change | None | Server address → gateway PC | Domain on, HTTPS on, port 443 |
| Extra hardware | None | An always-on office PC or Raspberry Pi | None |
| Depends on | Credentials from the WDMS account owner | Gateway PC staying on | MB360 firmware's HTTPS/TLS support (unverified) and a **static** office public IP |
| Punch latency | Pull interval (≥1 min) | Seconds | Seconds |
| Cloud Run caveat | The pull runs on a cron inside the container. With Cloud Run's default CPU-only-during-requests and `min-instances=0`, it **does not run while the service is idle**. Needs `--min-instances=1 --no-cpu-throttling` (always-on cost) | None: the device's requests are what wake the service | None |
| Security | WDMS credentials (stored, never returned to the UI) | Shared token over HTTPS. The device only talks to the LAN | IP allowlist only. ADMS carries no credential |

**Option A** needs no new code: add the device as **ZKTeco WDMS / BioTime server** with `116.202.116.58`, port `8081`, and the WDMS username and password. Optionally pin it to the MB360's serial with "Terminal serial". The rest of this document covers **B**, and C where it differs.

## 3. HRMS backend configuration

Set on the Cloud Run service (**Variables & Secrets**). `cloudbuild.backend.yaml` merges env vars, so these survive deploys.

| Variable | Value | Notes |
|---|---|---|
| `ADMS_ENABLED` | `true` | Receiver is off (404) without it. |
| `ADMS_GATEWAY_TOKEN` | 64 random hex chars | **Option B.** Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Same value goes in the gateway. |
| `ADMS_ALLOWED_IPS` | Office public IP, e.g. `196.41.10.7` or `196.41.10.0/28` | **Option C** (required). Optional extra check for B. |
| `TZ` | `Africa/Dar_es_Salaam` | **See §3.1. Strongly recommended.** |
| `BIOMETRIC_DEVICE_TIMEZONE` | `Africa/Dar_es_Salaam` | Zone the MB360's clock is set to. |
| `ADMS_POLL_DELAY_SECONDS` | `30` (default) | Heartbeat interval handed to the device. |
| `ADMS_PROXY_HOPS` | `1` (default) | Correct for Cloud Run. |

In production the receiver **refuses every device request (503)** unless `ADMS_GATEWAY_TOKEN` or `ADMS_ALLOWED_IPS` is set. A serial number is printed on the device's screen and is not a credential.

Then, once:

```bash
cd backend
MONGODB_URI="<production URI>" NODE_ENV=production JWT_ACCESS_SECRET=x JWT_REFRESH_SECRET=x npm run migrate:biometric
```

Production runs with `autoIndex` off. This builds the unique index that makes duplicate deliveries impossible. It is idempotent and changes no data. If it's skipped, the backend logs `biometricevents.dedupKey unique index is missing` at boot.

### 3.1 Time zone, which affects all attendance, not just this device

The attendance engine evaluates shift times (`09:00`), lateness, and the day boundary in the **server's** local zone. It always has; this integration does not change it. Cloud Run runs in **UTC** unless `TZ` is set, which would grade a 09:00 shift as starting at 12:00 East Africa Time.

**Administration → System Settings → Biometric devices** shows a warning when the server zone and the company zone (Company Profile → timezone) differ. Setting `TZ=Africa/Dar_es_Salaam` changes how *every* attendance source is graded from then on. Check a few recent days in the register after setting it.

## 4. Office gateway (option B)

`biometric-gateway/` is a single dependency-free Node script (Node 18+). It accepts requests only from the terminal's LAN address, forwards only `/iclock/*` to the HRMS over HTTPS, and adds the token. It never logs request bodies.

On the office PC:

1. Install Node.js LTS. Copy the `biometric-gateway` folder.
2. `copy gateway.env.example gateway.env` and set `UPSTREAM_URL` (the backend's `https://…run.app` URL), `GATEWAY_TOKEN`, and `ALLOWED_DEVICE_IPS` (the MB360's LAN IP).
3. `node gateway.js`. It prints `Biometric gateway listening`.
4. Make it survive reboots: NSSM (`nssm install HRMSBiometricGateway "C:\Program Files\nodejs\node.exe" "C:\hrms\biometric-gateway\gateway.js"`), Task Scheduler "At startup", or pm2.
5. Windows Firewall: allow inbound TCP 8081 **from the MB360's IP only**. Do **not** port-forward 8081 on the office router. The gateway needs no inbound internet access.
6. Give the MB360 a DHCP reservation or static IP, and give the gateway PC one as well.

## 5. Device setup (needs physical access to the MB360)

Menu names are from ZKTeco's standard firmware and may differ slightly on your unit.

1. **Photograph the current Cloud Server Settings** so they can be restored.
2. **System → Date Time:** confirm the date, time, and time zone are correct. Punch times come from this clock.
3. **System Info → Device Info:** note the **Serial Number** exactly.
4. **Comm → Ethernet:** note or set the device IP (static, or reserve it in DHCP).
5. In the HRMS: **Administration → System Settings → Biometric devices → Add device**:
   - Protocol: **ZKTeco ADMS push**
   - Serial number: from step 3
   - Accept punches from: defaults to the last 7 days. On first contact the terminal uploads its entire memory, and older punches are stored but not applied (see §7).
6. **Comm → Cloud Server Setting** on the device:

   | Setting | Option B (gateway) | Option C (direct) |
   |---|---|---|
   | Server Mode | ADMS | ADMS |
   | Enable Domain Name | OFF | ON |
   | Server Address | gateway PC's LAN IP | `hrms-backend-…run.app` |
   | Server Port | `8081` (= `LISTEN_PORT`) | `443` |
   | Enable Proxy Server | OFF | OFF |
   | HTTPS | OFF | ON |

7. Save. Some firmware needs a reboot before it re-handshakes.

## 6. Testing the connection

In order. Each step isolates one hop.

1. **Backend is up:** `GET https://<backend>/health` should include `"biometricReceiver":"enabled"`.
2. **Receiver accepts the token** (from any machine, using the device's real serial):
   ```bash
   curl -H "X-ADMS-Gateway-Token: <token>" "https://<backend>/iclock/cdata?SN=<SERIAL>&options=all"
   ```
   Expect a body starting `GET OPTION FROM: <SERIAL>`. Other replies: `401` means a token mismatch, `403 UNKNOWN DEVICE` means the serial isn't registered, and `503` means neither the token nor an allowlist is configured.
3. **Gateway forwards:** the gateway console shows `Forwarded … status 200` lines within a minute of the device being configured.
4. **Device is online:** the device's row shows **Online**. **Activity → Overview** shows "Last contact" seconds ago and the address it called from.
5. **A punch arrives:** punch on the device. Within seconds it appears in **Activity → Events**. Its status is *Unmapped* until mapping is done.
6. **Map and import:** **Map** → load reported users → choose each person's employee code → Save. Then **Activity → Import pending punches**. Events turn *Imported*.
7. **Attendance shows it:** open **Attendance → Register** for today. The employee's check-in time is shown with source BIOMETRIC.

Only after step 7 succeeds on the real device is the integration connected.

### Troubleshooting

| Symptom | Where to look | Likely cause |
|---|---|---|
| Banner: "calling in with a serial number that is not registered" | Settings banner | Serial typed differently from System Info. Use **Register** on the banner. |
| Device never shows Online, gateway console silent | Device Cloud Server Setting, gateway firewall | Wrong gateway IP or port, Windows Firewall blocking 8081, device and PC on different VLANs |
| Gateway logs `Refused: address not allowed` | `ALLOWED_DEVICE_IPS` | Device IP changed. Reserve it in DHCP. |
| Gateway logs `Upstream unreachable` | Gateway PC internet, `UPSTREAM_URL` | Office internet down. Punches stay on the device and arrive when it's back. |
| Gateway logs `status 401` | Tokens | `GATEWAY_TOKEN` ≠ `ADMS_GATEWAY_TOKEN` |
| Online but no events after a punch | Activity → Sync logs | Check *Rejected* counts and the Detail column. A wrong device clock is the usual cause. |
| Events stuck *Unmapped* | Activity → Unmapped device users | Map them, then **Import pending punches** |
| Events *Held* | Event tooltip | Day is locked for payroll, or was corrected manually or by regularization (§7) |
| Events *Ignored* | Activity → Overview | Older than "Accept punches from" (§7) |
| Times off by 3 hours | Settings banner, device clock | `TZ` / `BIOMETRIC_DEVICE_TIMEZONE` not set, or the device clock is in the wrong zone (§3.1) |
| Option C: device never connects | Device | Firmware cannot do HTTPS with Google's certificates/SNI. Use option B. |

Backend logs (Cloud Logging) to search for: `ADMS handshake`, `ADMS request rejected`, `ADMS request from an unregistered serial number`, `ADMS request failed`.

## 7. How punches are processed

- **Every punch is stored as a raw event** (`biometricevents`), separate from the daily attendance record, with the device serial, the device user ID, the time as the device sent it, the interpreted instant, the punch state, and the verify mode. No fingerprint or face templates, photos, card numbers, or device passcodes are requested or stored.
- **Deduplication:** an event's identity is device serial + device user ID + timestamp to the second, protected by a unique index. Retries, re-uploads, overlapping date-range requests, and two instances handling the same request all store one row. Separately, a punch already on the attendance day isn't appended again.
- **Mapping:** device user IDs map to existing employee codes per device (**Map**). Nothing is matched by name, and no employee is ever created. Unmapped punches wait, visible, until mapped and reprocessed.
- **Held, never overwritten:** a punch for a day that is **locked for payroll**, was **corrected manually**, or was **regularized** is stored as *Held* and not applied. Someone with `attendance:approve` can apply held punches over corrections from Activity, and that action is audited. Locked days stay held regardless.
- **Accept-from date:** punches older than the device's accept-from date are stored as *Ignored*. This prevents a first connection from re-grading months of already-paid attendance. To import a backlog deliberately, move the date in Activity → **Move date and import backlog**.
- **Night shifts:** for a shift that crosses midnight (e.g. 22:00–06:00), a punch is filed under the day the shift **started** if it falls before the middle of the off-duty gap (14:00 for that shift). One night shift is one attendance day, not two half-days.
- **Rules unchanged:** each affected day is recomputed by the existing engine (`recomputeDay` → `evaluateDay`). Shift length, lateness, early going, overtime, half-day, leave, comp-off, and payroll are untouched. The tests assert that a pushed day equals `evaluateDay` on the same punches.
- **Date-range re-upload:** **Activity → Request upload** queues `DATA QUERY ATTLOG` for the device to collect on its next heartbeat, capped at 62 days. Whether the MB360 firmware honours it is unverified. The device's return code is shown; `-1` usually means "no records in range" or "unsupported".

### Changes to existing behaviour

These came with the integration and apply to **all** biometric sources (scheduled pulls and `POST /attendance/biometric`), not just ADMS:

1. A punch already on the day (same instant, same device) is skipped rather than appended twice. Previously a back-dated re-sync doubled punches.
2. Punches for locked, manually corrected, or regularized days are held instead of re-deriving the day.
3. Night-shift punches after midnight are filed under the shift's start day. Previously they split one shift into two MISSING_PUNCH days.
4. Pulled punches from unmapped device users are kept as events and importable later. Previously they were discarded.

## 8. API reference

Admin (JWT; `tenant:read` for GETs, `tenant:update` for writes), under `/api/v1/administration/biometric`:

| | |
|---|---|
| `GET /status` | Receiver config, security mode, time-zone check, unregistered serials, device link states |
| `GET /devices/:id/status` | Device, counters (imported/duplicate/rejected/unmapped/held/ignored/failed), unmapped queue |
| `GET /devices/:id/events?status=&from=&to=&page=&limit=` | Raw events |
| `GET /devices/:id/logs` | Sync logs (kept 90 days) |
| `POST /devices/:id/reprocess` `{includeHeld?, includeIgnored?, acceptPunchesFrom?, from?, to?}` | Re-apply stored events |
| `POST /devices/:id/commands` `{type: QUERY_ATTLOG\|QUERY_USERINFO\|INFO, from?, to?}` | Queue a whitelisted request for an ADMS device |

Device-facing, at the root (no JWT; gateway token / IP allowlist + registered serial): `GET|POST /iclock/cdata`, `GET /iclock/getrequest`, `POST /iclock/devicecmd`.

## 9. Not verified, and needs the device or the manufacturer

- **Exact model variant, firmware and push-protocol version** of this MB360. The receiver records them on first contact (Activity → Overview: Firmware, Push protocol).
- **The ADMS wire format was implemented from** ZKTeco's "Attendance PUSH Communication Protocol" as documented by independent open-source implementations that were checked against real terminals: [s0x90/zkteco-adms](https://github.com/s0x90/zkteco-adms), and the [tanemrahman/zkteco-adms](https://packagist.org/packages/tanemrahman/zkteco-adms) and [dewanlab/laravel-zkteco-adms-core](https://packagist.org/packages/dewanlab/laravel-zkteco-adms-core) packages. ZKTeco does not publish the spec openly. Newer "Security PUSH" firmware adds a registry/token handshake (`/iclock/registry`). That is acknowledged but not implemented; if the MB360 uses it, Activity will show handshakes but no uploads, and the vendor's protocol document for that firmware is needed.
- **HTTPS support** for option C.
- **`DATA QUERY ATTLOG`** (date-range re-upload) support on this firmware.
- **Punch-state keys:** whether the device is configured to record check-in/check-out states. Attendance is computed first-punch-to-last-punch either way, so this only affects labels.
- **Sample payloads:** tests use synthetic, sanitised payloads in the documented format. Captured traffic from the real device (Activity → Events shows exactly what arrived) is the final check.
