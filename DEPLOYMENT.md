# HRMS — Production Deployment (GitHub → Cloud Build → Cloud Run)

Deploying this application to Google Cloud Run in `asia-south1`.

Replace every placeholder — `PROJECT_ID`, `BACKEND_URL`, `FRONTEND_URL`, `MONGO_URI` — with your own values. **No real credential belongs in this file, or in any file in this repository.**

---

## Read this first: two things that will bite you

**1. Employee documents do not survive a deploy.** The app writes uploads and identity documents to local disk. On Cloud Run that disk is in-memory, per-instance, and destroyed when the instance stops. Files uploaded today are gone after the next deploy, and a file uploaded on instance A is invisible to instance B. This is a **blocker for storing real employee documents** — see [File storage](#15-file-storage).

**2. The frontend calls the API cross-origin, which needs three backend settings.** `_VITE_API_URL` is an absolute URL compiled into the bundle, so the browser talks to `hrms-backend` directly. That requires `CLIENT_URL`, `COOKIE_SAME_SITE=none` and `COOKIE_SECURE=true` on the backend service — miss any one and login or session refresh fails, in ways the browser reports unhelpfully. See [CORS](#13-cors-configuration), which also covers the third-party-cookie risk this carries and how to revert to the same-origin proxy.

---

## Architecture

```
GitHub ──push──▶ Cloud Build ─── docker build
   backend/**  │                      ↓
   frontend/** │                 docker push :SHA      ──▶ Artifact Registry
               │                      ↓                         (asia-south1)
               │                 docker push :latest    ──▶
               │                      ↓
               └───────────────▶ gcloud run deploy --image :SHA
                                      ↓
                                  Cloud Run
                                      │
                        hrms-frontend (public, nginx)
                                      │
                                      │  serves the SPA
                                      ▼
                                  Browser
                                      │  calls the API directly (cross-origin)
                                      ▼
                                 hrms-backend
                                      │
                                      ├──▶ MongoDB Atlas
                                      └──▶ File storage
```

The push steps come **before** the deploy, deliberately: Cloud Build's `images:` field only uploads once every step has finished, so a deploy relying on it looks for an image that is not in the registry yet.

**The browser calls `hrms-backend` directly.** `_VITE_API_URL` is an absolute URL, compiled into the bundle, so requests bypass the frontend container's nginx proxy. This is a **cross-origin** setup and imposes three requirements on the backend service — `COOKIE_SAME_SITE=none`, `COOKIE_SECURE=true`, and `CLIENT_URL` set to the frontend's URL. See [§13](#13-cors-configuration).

The nginx proxy in the frontend image is still configured and still works; it is simply unused while the API URL is absolute. Switching back to same-origin is a one-line change to `_VITE_API_URL` plus a rebuild.

---

## 1. GitHub repository setup

The repository is already at `https://github.com/Alcoder0219/HRMS`.

Confirm nothing sensitive is tracked before granting Cloud Build access:

```bash
git ls-files | grep -E "\.env$|\.pem$|\.key$|service-account.*\.json$"   # must print nothing
git check-ignore -v backend/.env attachments backups                     # must show each is ignored
```

Branch model assumed below: `main` deploys to production. For a staging environment, create `staging` and duplicate the triggers with different service names.

---

## 2. GCP project setup

```bash
gcloud auth login
gcloud config set project PROJECT_ID
gcloud config set run/region asia-south1

# Confirm billing is active -- Cloud Run and Artifact Registry both require it.
gcloud billing projects describe PROJECT_ID
```

---

## 3. Required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com
```

Secret Manager is deliberately **not** enabled. Application configuration is entered directly on the Cloud Run service — see [Environment variables](#10-environment-variables).

---

## 4. Artifact Registry setup

```bash
gcloud artifacts repositories create hrms \
  --repository-format=docker \
  --location=asia-south1 \
  --description="HRMS backend and frontend images"
```

Images land at:

```
asia-south1-docker.pkg.dev/PROJECT_ID/hrms/hrms-backend:TAG
asia-south1-docker.pkg.dev/PROJECT_ID/hrms/hrms-frontend:TAG
```

`TAG` is the commit short SHA, so a deploy is always traceable to a commit. `latest` is also written, purely as a build cache source — never deploy from it.

---

## 5. Cloud Run setup

Both services are created by the first deploy; nothing to pre-create.

| | `hrms-backend` | `hrms-frontend` |
|---|---|---|
| Region | asia-south1 | asia-south1 |
| Port | 8080 | 8080 |
| Memory | 1Gi | 256Mi |
| CPU | 1 | 1 |
| Concurrency | 80 | 250 |
| Min / max instances | 0 / 10 | 0 / 10 |
| Timeout | 300s | 300s |
| Ingress | all | all |

Backend memory is 1Gi because ExcelJS and PDFKit assemble payroll exports entirely in memory. Min instances 0 keeps idle cost at zero at the price of a cold start; set `--min-instances=1` on the backend if the first login of the morning feeling slow matters more than the cost.

---

## 6. Cloud Build setup

Grant the Cloud Build service account the roles it needs to deploy:

```bash
PROJECT_NUMBER=$(gcloud projects describe PROJECT_ID --format='value(projectNumber)')
CB_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Deploy revisions to Cloud Run.
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:${CB_SA}" --role="roles/run.admin"

# Deploy AS the runtime service account.
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:${CB_SA}" --role="roles/iam.serviceAccountUser"

# Push images. Required by the explicit `docker push` steps in the pipeline --
# without it the build succeeds and the push fails with a 403.
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:${CB_SA}" --role="roles/artifactregistry.writer"
```

No `secretmanager.secretAccessor` grant is needed: configuration is held as plain environment variables on the service, which the runtime reads without extra permission.

**Impact:** `run.admin` lets any Cloud Build job deploy or delete any Cloud Run service in the project. That is standard for a deployment pipeline, but it means write access to this repository is effectively deploy access to production. For tighter separation, create a dedicated build service account with `roles/run.developer` scoped to these two services and set it on each trigger.

---

## 7. GitHub connection

Console → **Cloud Build → Triggers → Connect repository → GitHub (Cloud Build GitHub App)**, authorise, pick `Alcoder0219/HRMS`.

Then create two triggers. The **included files filter** is what stops a CSS change from redeploying the API:

**Trigger: `deploy-backend`**

| Field | Value |
|---|---|
| Event | Push to a branch |
| Branch | `^main$` |
| Included files filter | `backend/**`, `cloudbuild.backend.yaml` |
| Configuration | `cloudbuild.backend.yaml` |
| Substitution | `_TAG` = `$SHORT_SHA` |

**Trigger: `deploy-frontend`**

| Field | Value |
|---|---|
| Event | Push to a branch |
| Branch | `^main$` |
| Included files filter | `frontend/**`, `cloudbuild.frontend.yaml` |
| Configuration | `cloudbuild.frontend.yaml` |
| Substitutions | `_TAG` = `$SHORT_SHA` |

`_VITE_API_URL` and `_BACKEND_URL` already default to the deployed backend inside `cloudbuild.frontend.yaml`, so the trigger only needs to supply `_TAG`. Override them in the trigger if the API ever moves — and remember `_VITE_API_URL` keeps its `/api/v1` suffix while `_BACKEND_URL` has no path and no trailing slash.

A commit touching both directories fires both triggers, which is correct.

---

## 8. Backend deployment

The first build creates the service. It will start, then **fail its health check** — `MONGODB_URI`, `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are mandatory and are not yet set, so the process exits on a missing variable. That is expected and is the app refusing to run half-configured.

```bash
gcloud builds submit --config=cloudbuild.backend.yaml --substitutions=_TAG=manual .
```

Now add the application variables **once**, by hand:

**Cloud Run → `hrms-backend` → Edit & Deploy New Revision → Containers → Variables & Secrets → Environment variables**

| Name | Value |
|---|---|
| `MONGODB_URI` | your Atlas connection string |
| `JWT_ACCESS_SECRET` | generate: `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | generate a **different** one |
| `CLIENT_URL` | the frontend URL (step 9) |
| `COOKIE_SECURE` | `true` |
| `COOKIE_SAME_SITE` | `lax` |
| `REQUIRE_EMAIL_VERIFICATION` | `true` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | your mail provider |

Deploy the revision. It will boot.

**These survive every future deploy.** The pipeline uses `--update-env-vars`, which merges — it sets only `NODE_ENV`, `LOG_TO_FILE` and `TRUST_PROXY` and leaves everything else alone. (`--set-env-vars` would replace the whole environment and delete them; that is why it is not used.)

The same works from the CLI if you prefer:

```bash
gcloud run services update hrms-backend --region=asia-south1 \
  --update-env-vars=MONGODB_URI='...',JWT_ACCESS_SECRET='...',JWT_REFRESH_SECRET='...'
```

Note this puts the values in your shell history and in the command's audit log entry. The console avoids both.

Get the URL:

```bash
gcloud run services describe hrms-backend --region=asia-south1 --format='value(status.url)'
```

`COOKIE_SAME_SITE=none` with `COOKIE_SECURE=true` is **required** in the current cross-origin setup. The browser calls the backend from a different origin, so the refresh cookie is cross-site; with `lax` the browser refuses to send it and sessions stop refreshing. The backend's cookie helper silently downgrades `none` to `lax` when `COOKIE_SECURE` is false, so both must be set together or neither takes effect.

---

## 9. Frontend deployment

`_VITE_API_URL` is compiled into the bundle and **must include `/api/v1`** — it becomes axios's `baseURL` verbatim, and every endpoint is written relative to it.

```bash
gcloud builds submit --config=cloudbuild.frontend.yaml --substitutions=\
_TAG=manual,\
_VITE_API_URL=https://hrms-backend-33987356171.asia-south1.run.app/api/v1,\
_BACKEND_URL=https://hrms-backend-33987356171.asia-south1.run.app .
```

Both defaults are already set in `cloudbuild.frontend.yaml`, so a plain `--substitutions=_TAG=manual` works too. Neither URL may carry a trailing slash.

Then close the loop. The backend needs the frontend's URL for email links **and** to allow it through CORS — `CLIENT_URL` feeds both:

```bash
FRONTEND_URL=$(gcloud run services describe hrms-frontend --region=asia-south1 --format='value(status.url)')

gcloud run services update hrms-backend --region=asia-south1 --update-env-vars=\
CLIENT_URL=$FRONTEND_URL,COOKIE_SAME_SITE=none,COOKIE_SECURE=true
```

**Without that last command, login fails.** The browser's preflight is rejected because the frontend origin is not in the allowlist. Set it before testing.

### Reverting to same-origin

If cross-site cookies become a problem (see §13), rebuild with a relative URL — no other change is needed, because `_BACKEND_URL` already points nginx at the API:

```bash
gcloud builds submit --config=cloudbuild.frontend.yaml \
  --substitutions=_TAG=manual,_VITE_API_URL=/api/v1 .
gcloud run services update hrms-backend --region=asia-south1 \
  --update-env-vars=COOKIE_SAME_SITE=lax
```

The first deploy is necessarily circular: backend → frontend → update backend. Only the first time.

---

## 10. Environment variables

`VITE_*` values are compiled into the JavaScript at build time. Setting one on the Cloud Run **service** does nothing.

**Where each value comes from.** Three variables are owned by the pipeline and reapplied on every deploy. Everything else is owned by you, entered once in the Cloud Run console, and never touched by a deploy — the pipeline uses `--update-env-vars`, which merges into the existing environment rather than replacing it.

### Backend — set by the pipeline (do not edit by hand; a deploy overwrites them)

| Variable | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Also baked into the image |
| `LOG_TO_FILE` | `false` | Log to stdout for Cloud Logging |
| `TRUST_PROXY` | `2` | Cloud Run's frontend + nginx |

### Backend — set by you, in the console (survive every deploy)

**Cloud Run → `hrms-backend` → Edit & Deploy New Revision → Containers → Variables & Secrets**

| Variable | Value | Sensitive |
|---|---|---|
| `MONGODB_URI` | Atlas connection string | **Yes** — contains the DB password |
| `JWT_ACCESS_SECRET` | `openssl rand -base64 48` | **Yes** — forges any session |
| `JWT_REFRESH_SECRET` | a different one | **Yes** — same, long-lived |
| `SMTP_PASSWORD` | mail relay password | **Yes** |
| `CLIENT_URL` | `FRONTEND_URL` | Email links **and** the CORS allowlist. Required — logins fail without it |
| `COOKIE_SECURE` | `true` | Required alongside `SameSite=none` |
| `COOKIE_SAME_SITE` | `none` | Required for cross-origin. Use `lax` only if you rebuild same-origin |
| `REQUIRE_EMAIL_VERIFICATION` | `true` | |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `MAIL_FROM` | your mail provider | |
| `API_PREFIX` | `/api/v1` | Optional; must match `VITE_API_URL` |
| `ATTACHMENTS_DIR` | `/app/data/attachments` | Image default. **Ephemeral** — see §15 |
| `UPLOAD_DIR` | `/app/data/uploads` | Image default. **Ephemeral** — see §15 |
| `MAX_ACTIVE_SESSIONS`, `RATE_LIMIT_*`, `AUTH_RATE_LIMIT_*`, `BCRYPT_SALT_ROUNDS`, `JWT_*_EXPIRES_IN`, `JWT_ISSUER`, `JWT_AUDIENCE` | defaults are sane | Override only as needed |

`PORT` and `HOST` are absent from both tables on purpose: Cloud Run injects `PORT`, and setting it by hand will break the deploy.

Values marked sensitive are stored on the Cloud Run service itself. Anyone with `roles/run.viewer` on the project can read them in the console, and they appear in the revision's YAML. That is the trade for not using a secrets vault — acceptable for a small trusted team, worth revisiting if project access widens.

### Frontend

| Variable | Where | Notes |
|---|---|---|
| `VITE_API_URL` | Build arg | `/api/v1` — keep relative |
| `BACKEND_URL` | Runtime env var | Backend URL, **no trailing slash** |
| `MAX_UPLOAD_SIZE` | Runtime env var | `25m`; must exceed the API's own limit |

---

## 11. Sensitive configuration

**No secrets vault is used.** `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `SMTP_PASSWORD` are ordinary Cloud Run environment variables, entered by hand in the console as described in [§10](#10-environment-variables). The pipeline never reads or writes them.

Generate the JWT secrets **on your own machine** and paste them into the console:

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET  (must differ)
```

They are not in this repository and must never be.

### What this trade costs you

| | Env vars on the service (current) | A secrets vault |
|---|---|---|
| Visible to | Anyone with `roles/run.viewer` | Only `secretAccessor` holders |
| Appears in revision YAML | Yes | No — only a reference |
| Rotation | Edit + deploy a revision | New version, no redeploy |
| Access audit trail | No | Yes, per access |
| Setup | None | Extra API, IAM, cost |

Reasonable for a small trusted team. Worth revisiting if project access widens beyond the people who would be allowed to read the payroll database directly anyway — a `run.viewer` grant is enough to read the Atlas password today.

Two habits that matter given this choice:

- **Use the console, not the CLI**, for these values. A `gcloud run services update --update-env-vars=MONGODB_URI=...` lands in your shell history and in the command's audit log entry.
- **Restrict `roles/run.viewer`** on this project to people who should see production credentials.

**Rotating a JWT secret signs out every user immediately.** Existing tokens fail verification. Do it deliberately.

---

## 12. MongoDB configuration

Use MongoDB Atlas. Cloud Run has no static outbound IP by default, so Atlas IP allowlisting cannot identify it.

Two options:

**A — Allow all, rely on credentials + TLS (simplest).** Atlas → Network Access → `0.0.0.0/0`. Security then rests entirely on the connection string — which, in this setup, is a plain environment variable readable by anyone with `roles/run.viewer`. Those two decisions compound: keep that role tight, or choose B.

**B — Serverless VPC connector + Cloud NAT (recommended for PII).** Gives Cloud Run a fixed egress IP you can allowlist:

```bash
gcloud compute networks vpc-access connectors create hrms-connector \
  --region=asia-south1 --network=default --range=10.8.0.0/28

gcloud run services update hrms-backend --region=asia-south1 \
  --vpc-connector=hrms-connector --vpc-egress=all-traffic
```

Then create Cloud NAT and allowlist its IP in Atlas. This costs more and is the correct answer for a system holding salary and identity data.

Connection string:

```
mongodb+srv://USER:PASSWORD@cluster.mongodb.net/HRMS?retryWrites=true&w=majority
```

Put the Atlas cluster in `asia-south1` too — a cross-region hop is added to every query otherwise.

**The app fails safely without a database.** `server.js` connects *before* it listens, so an unreachable Mongo means the process exits non-zero and Cloud Run refuses to promote the revision. The previous revision keeps serving. Bad config cannot take production down.

**Do not run `npm run seed` against production.** It creates accounts with publicly known passwords. The script refuses when `NODE_ENV=production`; do not work around that.

---

## 13. CORS configuration

**CORS applies, and it must be configured.** `_VITE_API_URL` is absolute, so the browser calls `hrms-backend` from the `hrms-frontend` origin — a genuine cross-origin request with credentials.

Three settings on the **backend** service make it work. All three, or none of them do:

| Variable | Value | If missing |
|---|---|---|
| `CLIENT_URL` | the frontend's URL | Preflight rejected — every API call fails, login included |
| `COOKIE_SAME_SITE` | `none` | Browser refuses to send the refresh cookie; sessions die at the 15-minute access-token expiry |
| `COOKIE_SECURE` | `true` | The cookie helper downgrades `none` back to `lax`, so the setting above silently does nothing |

`CLIENT_URL` is folded into the allowlist automatically ([`backend/config/cors.js`](backend/config/cors.js)), so the frontend origin only needs naming once. `CORS_ALLOW_LAN` is forced off under `NODE_ENV=production`. A wildcard origin is impossible here regardless — browsers reject `*` alongside credentials.

### The cost of this choice

Going direct rather than through the proxy has a real, dated risk:

- **The refresh cookie is third-party.** Safari's ITP blocks third-party cookies by default today. Chrome is phasing them out. When that lands for your users, `SameSite=none` stops being enough and sessions break with no error message that points at the cause.
- **The backend URL is frozen into the bundle.** Moving or renaming the API means rebuilding the frontend, not just redeploying it.
- **Every API call pays a CORS preflight** on non-simple requests — an extra round trip.

The same-origin proxy avoids all three, and the frontend image still supports it. If sessions start dropping in Safari, that is this, and [§9 "Reverting to same-origin"](#9-frontend-deployment) is the fix.

---

## 14. Custom domain configuration

```bash
gcloud beta run domain-mappings create --service=hrms-frontend \
  --domain=hrms.example.com --region=asia-south1
```

Add the DNS records it prints. Certificates are provisioned automatically (15 min–24 h).

Then update the backend so email links point at the real domain:

```bash
gcloud run services update hrms-backend --region=asia-south1 \
  --update-env-vars=CLIENT_URL=https://hrms.example.com
```

The backend needs no domain of its own — it is reached through the proxy.

---

## 15. File storage

**BLOCKER for production use with real employee documents.**

Current implementation — local filesystem, no cloud storage SDK installed:

| Data | Path | Written by |
|---|---|---|
| Avatars, documents | `UPLOAD_DIR` (`/app/data/uploads`) | Multer `diskStorage` |
| Identity documents (PAN, passport, Aadhaar) | `ATTACHMENTS_DIR` (`/app/data/attachments`) | `helpers/employeeFiles.helper.js` |
| DB dumps | `backups/` | Admin backup feature |

On Cloud Run this means:

1. **Ephemeral.** The filesystem is in-memory and dies with the instance. Every deploy loses every uploaded file.
2. **Not shared.** With `max-instances=10`, a file written by one instance 404s on the other nine.
3. **Counts against memory.** Files written to disk consume the container's RAM allowance.

Do not treat Cloud Run storage as document storage. Three ways forward:

**A — Cloud Storage (recommended).** Create a bucket in `asia-south1`, add `@google-cloud/storage`, and replace the Multer disk destination with a GCS write. Signed URLs preserve the existing access model: attachments stay non-public and are served through a time-limited URL rather than a static mount. *This is an application change and is deliberately out of scope here.*

**B — GCS FUSE volume mount.** Mount a bucket as a directory and point `ATTACHMENTS_DIR` / `UPLOAD_DIR` at it. **No code change** — the config now accepts absolute paths specifically to allow this. Slower than a native client and has POSIX quirks, but it is the fastest correct path:

```bash
gcloud beta run services update hrms-backend --region=asia-south1 \
  --add-volume=name=docs,type=cloud-storage,bucket=YOUR_BUCKET \
  --add-volume-mount=volume=docs,mount-path=/mnt/docs \
  --update-env-vars=ATTACHMENTS_DIR=/mnt/docs/attachments,UPLOAD_DIR=/mnt/docs/uploads
```

**C — Deploy the backend somewhere with a real disk** (GCE, GKE with a persistent volume) and keep only the frontend on Cloud Run.

**Migrating existing files:** `attachments/` currently holds real employee documents. Copy them to the bucket *before* switching, and do not delete the originals until verified:

```bash
gcloud storage cp --recursive ./attachments gs://YOUR_BUCKET/attachments
```

`backups/` (31 MB of database dumps containing password hashes and session tokens) is git-ignored and must stay that way. It belongs in a private bucket with retention, not in the image or the repository.

---

## 16. Logs

```bash
# Live tail
gcloud beta run services logs tail hrms-backend --region=asia-south1

# Errors in the last hour
gcloud logging read \
  'resource.type=cloud_run_revision AND resource.labels.service_name=hrms-backend AND severity>=ERROR' \
  --limit=50 --freshness=1h
```

The backend emits JSON to stdout with a `severity` field, so Cloud Logging parses it into filterable fields rather than one opaque string. `LOG_TO_FILE=false` disables the on-disk rotation, which would only be writing to a disk that gets thrown away.

**Log retention is a compliance question.** The application intended 90 days for payroll and PII activity. Cloud Logging's `_Default` bucket keeps 30. To preserve the original intent:

```bash
gcloud logging buckets update _Default --location=global --retention-days=90
```

---

## 17. Rollback

Deploys are tagged with the commit SHA, so rollback is redeploying a known image:

```bash
# What is live, and what came before
gcloud run revisions list --service=hrms-backend --region=asia-south1 --limit=5

# Shift 100% of traffic back
gcloud run services update-traffic hrms-backend --region=asia-south1 \
  --to-revisions=hrms-backend-00042-abc=100
```

Rollback is instant and does not rebuild. **It does not roll back the database** — a revision that changed data leaves that data changed.

Gradual rollout instead of all-at-once:

```bash
gcloud run services update-traffic hrms-backend --region=asia-south1 \
  --to-revisions=NEW=10,OLD=90
```

---

## 18. Updating the application

```bash
git add -A
git commit -m "Describe the change"
git push origin main
```

Cloud Build picks it up, builds only the affected service, and deploys. Watch it:

```bash
gcloud builds list --limit=5
gcloud builds log --stream BUILD_ID
```

---

## 19. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Revision fails: "container failed to listen on PORT" | App bound the wrong port | Do not set `PORT`; Cloud Run injects it |
| Revision fails immediately, `MongoServerSelectionError` in logs | Atlas unreachable or wrong URI | Check the secret and Atlas network access (§12). Working as designed — it refuses to serve without a DB |
| Boot error `Missing required environment variable` | A mandatory var is unset | The message names it. Add it under Variables & Secrets (§10) |
| Variables disappeared after a deploy | A deploy used `--set-env-vars`, which replaces the whole environment | The pipeline uses `--update-env-vars`, which merges. Do not change it back |
| `Image ... not found` at the deploy step | The image was not pushed before the deploy ran | Fixed: the pipeline now has explicit `push-immutable` / `push-latest` steps before `deploy`. Do not rely on `images:` for ordering |
| Every `/api` route 404s | `BACKEND_URL` has a trailing slash | Remove it; nginx strips `/api/` otherwise |
| 502 from the frontend on `/api` | Backend rejecting the proxy, or down | `curl BACKEND_URL/health` directly |
| Login works, user logged out ~15 min later | Refresh cookie not being sent | Set `COOKIE_SAME_SITE=none` AND `COOKIE_SECURE=true` on the backend -- either alone does nothing (§13) |
| Login fails, browser console shows a CORS error | `CLIENT_URL` not set to the frontend origin | `gcloud run services update hrms-backend --update-env-vars=CLIENT_URL=<frontend url>` |
| API calls 404 with a valid backend | `_VITE_API_URL` missing the `/api/v1` suffix | It is used as axios's baseURL verbatim (§9) |
| Sessions break in Safari only | Third-party cookie blocking | Expected in cross-origin mode. Revert to same-origin (§9) |
| Uploads fail with 413 | nginx body limit below the app's | Raise `MAX_UPLOAD_SIZE` |
| Uploaded files vanish after a deploy | Ephemeral filesystem | Expected. §15 |
| Everyone 429s at once | `TRUST_PROXY` too low — all users share one bucket | Set `TRUST_PROXY=2` |
| Build fails at `npm ci` | Lockfile out of sync | `npm install` locally, commit the lockfile |

---

## 20. Health check

| Service | Endpoint | Returns |
|---|---|---|
| Backend | `GET /health` | `{"success":true,"status":"ok","environment","uptime","database","timestamp"}` |
| Frontend | `GET /healthz` | `{"status":"ok","service":"hrms-frontend"}` |

```bash
curl -s BACKEND_URL/health
curl -s FRONTEND_URL/healthz
curl -s FRONTEND_URL/api/v1/../../health   # proves the proxy reaches the backend
```

`/health` sits outside the API prefix and the rate limiter so probes never consume a user's quota. It returns 200 whenever the process is alive, reporting `database` separately — correct for a liveness probe, since a process that cannot reach Mongo should be *reported*, not killed and restarted into the same failure.

Note it does disclose `NODE_ENV` and database connection state to anyone who calls it. Low risk and pre-existing, but if you would rather it disclosed nothing, reduce it to `{"status":"ok"}` — nothing depends on the other fields.

---

## How a git push becomes a deployment

```
git push origin main
   │
   ▼
GitHub notifies the Cloud Build GitHub App
   │
   ▼
Triggers evaluate their included-files filter
   ├─ backend/**  changed → deploy-backend
   └─ frontend/** changed → deploy-frontend
   │
   ▼
Cloud Build (per trigger), steps in this exact order
   ├─ 1. build           docker build --cache-from :latest, tags :SHORT_SHA + :latest
   ├─ 2. push-immutable  docker push ...:SHORT_SHA   ◀── must precede the deploy
   ├─ 3. push-latest     docker push ...:latest       (cache pointer only)
   └─ 4. deploy          gcloud run deploy --image ...:SHORT_SHA
   │
   ▼
Cloud Run creates a revision, health-checks it, shifts traffic
   └─ Fails the check → traffic stays on the previous revision
```

A failed build or a revision that will not start **cannot take production down** — traffic only moves to a revision that started successfully.
