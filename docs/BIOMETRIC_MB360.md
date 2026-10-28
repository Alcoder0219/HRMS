# MB360 biometric terminal → HRMS attendance

How the ZKTeco MB360 at the office gets its punches into the HRMS Attendance module, how to set it up, and how to tell whether it is working.

> **Status (28 Oct 2026):** the HRMS side is built and tested against simulated device traffic. The MB360 (serial `UEED245000038`) is already pushing ADMS requests to a logging receiver on the GCP VM `34.45.67.52:8081`. **No real punch has reached HRMS attendance yet.** The device is not "connected" until the check in [§0.6](#06-verify-the-first-real-punch) passes.

---

## 0. Current deployment: GCP VM gateway → HRMS (easy WDMS is not used)

```
MB360 ──HTTP :8081──▶ GCP VM 34.45.67.52            ──HTTPS + token──▶ Cloud Run hrms-backend /iclock ──▶ MongoDB Atlas
(office)              biometric-gateway (systemd)                        (serial check, raw events,
                      no database access, no data stored                  dedup, mapping, attendance rules)
```

**Why the VM forwards instead of writing to MongoDB.** The HRMS backend already contains the full ADMS receiver: serial validation, raw punch storage behind a unique index, user mapping, the hold rule for locked or corrected days, and the existing attendance engine. A receiver that wrote to MongoDB itself would duplicate that logic in a second language. The VM therefore holds only a shared token, and the attendance rules run in exactly one place.

**Durability.** If Cloud Run or Atlas is down, the receiver answers `ERROR` (HTTP 500) or the gateway answers 502. Either way the terminal does not get its acknowledgement, keeps the batch, and resends it after `ErrorDelay`. The event store de-duplicates the resend. Nothing is queued on the VM, so nothing can be lost there.

### 0.1 Cloud Run (`hrms-backend`)

Set these under **Variables & Secrets**, or with `gcloud`:

```bash
TOKEN=$(openssl rand -hex 32)   # keep this; the VM needs the same value
gcloud run services update hrms-backend --region asia-south1 --update-env-vars \
ADMS_ENABLED=true,ADMS_GATEWAY_TOKEN=$TOKEN,ADMS_ALLOWED_IPS=34.45.67.52,\
ADMS_DEVICE_SERVER_ADDRESS=34.45.67.52,ADMS_DEVICE_SERVER_PORT=8081,ADMS_DEVICE_HTTPS=false,\
TZ=Asia/Kolkata,BIOMETRIC_DEVICE_TIMEZONE=Asia/Kolkata
```

- `ADMS_ALLOWED_IPS=34.45.67.52` means only the VM may call the receiver, and it must also present the token.
- `TZ` and `BIOMETRIC_DEVICE_TIMEZONE`: the Company Profile timezone is currently `Asia/Kolkata`. Before relying on these values, confirm that the **device clock** is also on Indian time. See §0.6, step 4.
- Run the index migration once, from a machine Atlas allows:
  ```bash
  cd backend && MONGODB_URI="<production URI>" NODE_ENV=production JWT_ACCESS_SECRET=x JWT_REFRESH_SECRET=x npm run migrate:biometric
  ```

### 0.2 The VM: replace the Flask logger with the gateway

`receiver.py` answers `OK` to everything and stores nothing. **Every punch the MB360 sent to it was acknowledged and discarded**, and the device will not resend those punches by itself (see §0.6, step 5). It also runs on Flask's development server. Stop it before starting the gateway, because both use port 8081.

From your PC (repository root), copy the gateway to the VM:

```bash
gcloud compute scp biometric-gateway/gateway.js biometric-gateway/package.json \
  biometric-gateway/gateway.env.example biometric-gateway/hrms-biometric-gateway.service \
  VM_NAME:/tmp/ --zone ZONE
```

On the VM:

```bash
# 1. Stop the Flask logger (however it was started)
pkill -f receiver.py || true
sudo systemctl disable --now mb360-adms 2>/dev/null || true   # only if you made a unit for it

# 2. Node.js (Debian 12 ships Node 18, which is enough)
sudo apt-get update && sudo apt-get install -y nodejs
node --version            # must print v18 or later

# 3. Install as an unprivileged service
sudo useradd --system --no-create-home --shell /usr/sbin/nologin hrmsgw
sudo mkdir -p /opt/hrms-biometric-gateway
sudo cp /tmp/gateway.js /tmp/package.json /tmp/gateway.env.example /opt/hrms-biometric-gateway/
sudo cp /opt/hrms-biometric-gateway/gateway.env.example /opt/hrms-biometric-gateway/gateway.env
sudo nano /opt/hrms-biometric-gateway/gateway.env
#    UPSTREAM_URL=https://<hrms-backend URL>     (no path, no trailing slash)
#    GATEWAY_TOKEN=<the same $TOKEN as Cloud Run>
#    ALLOWED_DEVICE_IPS=<office PUBLIC IP>       (the source address in your receiver.py logs)
sudo chown -R root:hrmsgw /opt/hrms-biometric-gateway
sudo chmod 640 /opt/hrms-biometric-gateway/gateway.env

# 4. Start it, and on every boot
sudo cp /tmp/hrms-biometric-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hrms-biometric-gateway
curl -s http://127.0.0.1:8081/healthz          # -> ok
journalctl -u hrms-biometric-gateway -f        # live log
```

If you don't know the office's public IP yet, start with it unset and read it from the log. The gateway logs `Refused: address not allowed` with the caller's `from` address. Put that address in `ALLOWED_DEVICE_IPS`, then `sudo systemctl restart hrms-biometric-gateway`.

### 0.3 VM network: firewall and static IP

```bash
# What is open today, and which tags the VM carries
gcloud compute firewall-rules list --format="table(name,direction,sourceRanges.list(),allowed[].map().firewall_rule().list(),targetTags.list())"
gcloud compute instances describe VM_NAME --zone ZONE --format="value(tags.items)"

# Allow 8081 from the office only
gcloud compute instances add-tags VM_NAME --zone ZONE --tags mb360-receiver
gcloud compute firewall-rules create allow-mb360-adms --direction INGRESS --action ALLOW \
  --rules tcp:8081 --source-ranges OFFICE_PUBLIC_IP/32 --target-tags mb360-receiver

# Then remove whichever existing rule opens 8081 to 0.0.0.0/0
gcloud compute firewall-rules delete OLD_RULE_NAME

# Keep 34.45.67.52 if the VM restarts (promote the ephemeral IP to static)
gcloud compute addresses create mb360-receiver-ip --addresses 34.45.67.52 --region REGION
```

If the office's public IP changes (a dynamic broadband line), the firewall rule and `ALLOWED_DEVICE_IPS` both break when it does. In that case either get a static IP from the ISP, or use a CIDR range covering the ISP's pool. Use `0.0.0.0/0` together with `ALLOWED_DEVICE_IPS=*` only as a last resort: the registered serial number is then the only check.

**HTTPS:** the leg from the terminal to the VM is plain HTTP across the internet. It carries device user IDs and punch times, with no passwords and no biometric data. The VM-to-HRMS leg is HTTPS. Encrypting the first leg needs a domain name, a TLS certificate on the VM, and MB360 firmware that accepts it. None of that is in place or verified; restricting the firewall to the office IP is the mitigation for now.

### 0.4 The MB360: no change needed

It already points at the VM. For reference, **Comm → Cloud Server Setting**: Server Mode `ADMS`, Enable Domain Name `OFF`, Server Address `34.45.67.52`, Server Port `8081`, Enable Proxy Server `OFF`, HTTPS `OFF`. The device form in the HRMS shows the same values once the receiver address is known. Enter `http://34.45.67.52:8081` once under **Add device → ZKTeco ADMS push → Receiver URL → Save address** (needs tenant-settings rights; audited). Alternatively, set `ADMS_DEVICE_SERVER_ADDRESS` on Cloud Run, which then takes precedence and locks the field.

### 0.5 Register the device and map employees

1. **Administration → System Settings → Biometric devices.** Delete the old `Camel Oil MB360` row (protocol `WDMS_API`, which has no data).
2. **Add device:**
   - Protocol: **ZKTeco ADMS push**
   - Serial: `UEED245000038`
   - Accept punches from: the date the MB360 was first pointed at the VM, so the punches Flask discarded can be recovered (step 5 below)
   - Location: optional
3. Within a minute the row shows **Online** and "Seen just now". If it shows "Never connected" instead, read §6 Troubleshooting.
4. **Map:** click **Load reported users**. This lists the IDs the device has reported or punched with. To get the full roster of 242 people, use **Activity → Request upload → Request user list** first. Choose each person's HRMS employee, keep **"After saving, import the waiting punches"** ticked, and save. One device user ID can only be mapped to one employee.

### 0.6 Verify the first real punch

1. Have a mapped employee punch on the MB360.
2. **Activity → Events:** the punch appears within seconds as **Imported**. Check that **Device clock** matches the time on the device's screen.
3. **Attendance → Register** for today: the employee has a check-in with source BIOMETRIC.
4. **Timezone:** the *Punch time* column (shown in your browser's timezone) must match the time the person actually punched. If it is off by a fixed number of hours, the device clock and `BIOMETRIC_DEVICE_TIMEZONE` disagree. Fix the device clock (System → Date Time) or the variable.
5. **Recover what Flask discarded:** **Activity → Request upload** for the dates since the device was pointed at the VM. Whether this MB360's firmware honours the request is unverified; the result is shown in the same tab (return code `0` = done, `-1` = nothing in range or unsupported). Re-sent punches are de-duplicated. If the firmware refuses, export those days from the device's USB menu and use **Attendance → Biometric Import**.

Only after steps 1–4 succeed is the device connected.

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

**Administration → System Settings → Biometric devices** shows a warning when the server zone and the company zone (Company Profile → timezone) differ. It compares UTC offsets, so it clears by itself once the server really runs in the company's zone. Setting `TZ` changes how *every* attendance source is graded from then on.

**Existing data must move with it.** Days are keyed by midnight in the server's zone, and exact lookups match that key. Rows written under UTC sit at `00:00Z`; in Asia/Kolkata the same day is keyed at `18:30Z` the evening before. Right after the revision with `TZ` is live, and before anyone edits attendance, run:

```bash
cd backend
TZ=Asia/Kolkata MONGODB_URI="<production URI>" npm run migrate:day-keys -- --timezone=Asia/Kolkata          # preview
TZ=Asia/Kolkata MONGODB_URI="<production URI>" npm run migrate:day-keys -- --timezone=Asia/Kolkata --apply  # write
```

The migration moves only the day keys in `attendances.date`, `compoffs.earnedOn` and `regularizations.date`, to the same calendar date. No figure is recomputed and no timestamp changes. If a row already exists at the new key for the same employee, both rows are left alone and reported. A second run finds nothing.

Figures computed under UTC (lateness against a 09:00 shift evaluated as 14:30 IST, for example) stay as they were. Recomputing past days is a separate decision for whoever owns payroll.

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
