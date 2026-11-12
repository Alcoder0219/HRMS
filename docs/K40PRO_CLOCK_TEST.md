# K40PRO clock test: isolated gateway on port 8082

**Status: a test, not a fix.** The K40PRO (serial `GED7253100014`) changes its
clock when it connects to the network. One possible cause is the HTTP `Date`
header in the gateway's replies. This procedure tests that on the real
terminal without touching the production gateway (port 8081) or the MB360
(`UEED245000038`). Nothing here is proven until Test 2 succeeds on the K40PRO.

What does not change at any point:

- the production gateway service, its folder `/opt/hrms-biometric-gateway`, its `gateway.env`, and port 8081
- the MB360's settings
- the HRMS backend, its settings, and attendance data
- `https://hrms.amsonsfoundation.net/`

## What the test copy does

It runs the same `gateway.js` with one extra setting:

```
NO_DATE_HEADER_SERIALS=GED7253100014
```

Replies to requests carrying `SN=GED7253100014` are sent without a `Date`
header. Every other request, including the MB360's and any other terminal's,
gets the same reply as production, header for header. When the setting is
empty (the default, and what production uses) the new `gateway.js` behaves
exactly like the committed one. `npm test` in `biometric-gateway/` proves this.

## Test 1: network time, or the ADMS connection? (no code, no gateway change)

Run this outside working hours so no real punch is recorded with a wrong clock.

1. **Record the current settings.** Photograph the K40PRO's screens so they can be put back exactly:
   - Date/Time: timezone, daylight saving, and any NTP or auto-sync option
   - Ethernet: DHCP, IP, gateway, DNS
   - ADMS / Cloud Server: address, port, HTTPS, domain, proxy

   Set a phone to Africa/Dar_es_Salaam time to use as the reference clock.
2. **A: control.** Unplug the cable, set the correct time, and wait 10 minutes. The clock should stay correct.
3. **B: network on, ADMS unreachable.**
   1. With the cable still unplugged, change only the ADMS **server port** from 8081 to **9999**.
   2. Set the correct time again and plug the cable in.
   3. Read the clock at 1, 2, 5 and 10 minutes.
4. **C: normal ADMS connection.**
   1. Set the port back to **8081** and keep watching for a minute.
   2. Note the exact time shown after any jump.
   3. Set the correct time again.

| B | C | Meaning |
|---|---|---|
| clock changes | – | NTP or DHCP time on the terminal. This gateway test will **not** help; look for an NTP or auto-sync option on the K40PRO |
| stays correct | jumps (about +5h) | the ADMS connection changes the clock: go on to Test 2 |
| stays correct | stays correct | not reproduced: repeat C by re-saving the server settings and note exactly when the clock jumps |

## Firewall requirements for Test 2

The terminal reaches the gateway VM from the office's public address
`196.41.46.195`. Port 8082 must be opened to that address only.

**Google Cloud.** This changes production infrastructure, so it needs approval
first. The existing 8081 rule is not touched.

```bash
# find the VM's network and network tag (read-only)
gcloud compute instances describe <gateway-vm-name> --zone=<zone> --format="value(networkInterfaces[0].network,tags.items)"

gcloud compute firewall-rules create hrms-gw-test-8082 \
  --network=<network> --direction=INGRESS --action=allow --rules=tcp:8082 \
  --source-ranges=196.41.46.195/32 --target-tags=<network tag>
```

**On the VM.** Only if `sudo ufw status` says it is active:

```bash
sudo ufw allow from 196.41.46.195 to any port 8082 proto tcp
```

**Office router.** No change. It already lets the terminal call the VM.

## Run the test copy (on the VM; needs approval)

Upload the new `biometric-gateway/gateway.js` to the VM first, for example to
your home folder.

```bash
# 1. A separate folder. The production folder is not touched.
sudo mkdir /opt/hrms-biometric-gateway-test
sudo cp ~/gateway.js /opt/hrms-biometric-gateway-test/gateway.js

# 2. Copy the production settings (same token, never printed), then change the COPY only
sudo cp /opt/hrms-biometric-gateway/gateway.env /opt/hrms-biometric-gateway-test/gateway.env
sudo sed -i 's/^LISTEN_PORT=.*/LISTEN_PORT=8082/' /opt/hrms-biometric-gateway-test/gateway.env
echo 'NO_DATE_HEADER_SERIALS=GED7253100014' | sudo tee -a /opt/hrms-biometric-gateway-test/gateway.env >/dev/null
sudo chown -R root:hrmsgw /opt/hrms-biometric-gateway-test
sudo chmod 640 /opt/hrms-biometric-gateway-test/gateway.env

# 3. Start it as a temporary service: not enabled, gone after a reboot
sudo systemd-run --unit=hrms-gateway-test --uid=hrmsgw --gid=hrmsgw \
  -p WorkingDirectory=/opt/hrms-biometric-gateway-test \
  /usr/bin/node /opt/hrms-biometric-gateway-test/gateway.js
journalctl -u hrms-gateway-test -n 5
#    expect: "listen":"0.0.0.0:8082" and "noDateHeaderFor":["GED7253100014"]

# 4. Check it from the VM itself. A 403 FORBIDDEN is expected from localhost;
#    look only at whether a Date header is present.
curl -s -i "http://127.0.0.1:8082/iclock/getrequest?SN=GED7253100014" | grep -i '^date' || echo "K40PRO: no Date header (correct)"
curl -s -i "http://127.0.0.1:8082/iclock/getrequest?SN=UEED245000038" | grep -i '^date'
#    the second command should print a Date line: the MB360 keeps it

# 5. Production is still running, untouched
systemctl is-active hrms-biometric-gateway
```

## Test 2: the K40PRO on 8082

1. On the K40PRO, change only the server **port** from 8081 to **8082**. The address stays `34.45.67.52` and HTTPS stays off.
2. Watch `journalctl -u hrms-gateway-test -f`. The K40PRO's requests should appear, uploads marked `"dateHeader":"omitted"`.
3. Set the correct time. Unplug and replug the cable, and read the clock at 1, 5 and 15 minutes.
4. Make one test punch. In HRMS, under Administration → System Settings → Biometric devices → K40PRO activity, confirm:
   - it arrived
   - the device time matches the real Tanzania time
   - the terminal shows online
5. Confirm the MB360 is still online and uploading. It stays on 8081 throughout.

**Pass:** the clock stays correct after reconnecting, and punches arrive at the right time.

**Fail:** the clock still jumps, which means the cause is elsewhere. Roll back and report what the clock showed.

## Rollback (any time)

```bash
# 1. First, on the K40PRO: set the port back to 8081.
# 2. Then, on the VM:
sudo systemctl stop hrms-gateway-test
sudo rm -rf /opt/hrms-biometric-gateway-test
gcloud compute firewall-rules delete hrms-gw-test-8082
sudo ufw delete allow from 196.41.46.195 to any port 8082 proto tcp   # only if added above
```

Punches made while the test copy was down stay on the terminal and upload once
it reconnects.

## After a successful Test 2 (separate approval)

To make it permanent: deploy the new `gateway.js` to the production folder and
add `NO_DATE_HEADER_SERIALS=GED7253100014` to the production `gateway.env`, then
restart the production service. This is a production change and is not part of
this test.
