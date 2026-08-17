# HRMS — Production Deployment (GitHub → Cloud Build → Cloud Run)

Deploying this application to Google Cloud Run in `asia-south1`.

Replace every placeholder — `PROJECT_ID`, `BACKEND_URL`, `FRONTEND_URL`, `MONGO_URI` — with your own values. **No real credential belongs in this file, or in any file in this repository.**

---

## Read this first: two things that will bite you

**1. Employee documents do not survive a deploy.** The app writes uploads and identity documents to local disk. On Cloud Run that disk is in-memory, per-instance, and destroyed when the instance stops. Files uploaded today are gone after the next deploy, and a file uploaded on instance A is invisible to instance B. This is a **blocker for storing real employee documents** — see [File storage](#15-file-storage).

**2. The frontend proxies the API; it does not call it cross-origin.** The browser only ever talks to the frontend's origin. nginx inside the frontend container forwards `/api` and `/uploads` to the backend. This is deliberate — see [CORS](#13-cors-configuration) for why the alternative breaks logins.

---

## Architecture

```
GitHub  ──push──▶  Cloud Build  ──▶  Artifact Registry  ──▶  Cloud Run
                        │                                       │
              backend/** │ frontend/**                  hrms-frontend (public)
                                                             │  nginx
                                                             │  /api, /uploads
                                                             ▼
                                                        hrms-backend
                                                             │
                                                             ├──▶ MongoDB Atlas
                                                             └──▶ File storage
```

The browser reaches `hrms-frontend` only. `hrms-backend` is reached through the proxy.

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
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

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

# Push images.
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:${CB_SA}" --role="roles/artifactregistry.writer"
```

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
| Substitutions | `_TAG` = `$SHORT_SHA`, `_BACKEND_URL` = the backend's URL from step 8 |

A commit touching both directories fires both triggers, which is correct.

---

## 8. Backend deployment

Secrets must exist before the first deploy — see [Secret Manager](#11-secret-manager). Then:

```bash
gcloud builds submit --config=cloudbuild.backend.yaml --substitutions=_TAG=manual .
```

Attach the secrets and configuration to the service **once**. These persist across deploys, which is why `cloudbuild.backend.yaml` does not repeat them:

```bash
gcloud run services update hrms-backend --region=asia-south1 \
  --update-secrets=MONGODB_URI=hrms-mongodb-uri:latest,\
JWT_ACCESS_SECRET=hrms-jwt-access-secret:latest,\
JWT_REFRESH_SECRET=hrms-jwt-refresh-secret:latest,\
SMTP_PASSWORD=hrms-smtp-password:latest \
  --update-env-vars=\
CLIENT_URL=FRONTEND_URL,\
COOKIE_SECURE=true,\
COOKIE_SAME_SITE=lax,\
REQUIRE_EMAIL_VERIFICATION=true,\
SMTP_HOST=smtp.example.com,\
SMTP_PORT=587,\
SMTP_USER=no-reply@example.com,\
[email protected]
```

Get the URL:

```bash
gcloud run services describe hrms-backend --region=asia-south1 --format='value(status.url)'
```

`COOKIE_SAME_SITE=lax` is correct **because the frontend proxies the API** — the cookie is first-party. Only use `none` if you switch to direct cross-origin calls, and it then requires `COOKIE_SECURE=true`.

---

## 9. Frontend deployment

Pass the backend URL from step 8. **No trailing slash** — with one, nginx strips the `/api/` prefix and every route 404s:

```bash
gcloud builds submit --config=cloudbuild.frontend.yaml \
  --substitutions=_TAG=manual,_BACKEND_URL=https://hrms-backend-xxxx-el.a.run.app .
```

Then close the loop — the backend needs the frontend's URL for email links:

```bash
FRONTEND_URL=$(gcloud run services describe hrms-frontend --region=asia-south1 --format='value(status.url)')
gcloud run services update hrms-backend --region=asia-south1 --update-env-vars=CLIENT_URL=$FRONTEND_URL
```

The first deploy is necessarily circular: backend → frontend → update backend. Only the first time.

---

## 10. Environment variables

`VITE_*` values are compiled into the JavaScript at build time. Setting one on the Cloud Run **service** does nothing.

### Backend — Cloud Run env vars (not secret)

| Variable | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Set in the image |
| `PORT` | *(unset)* | Cloud Run injects it |
| `HOST` | `0.0.0.0` | Set in the image |
| `TRUST_PROXY` | `2` | Cloud Run's frontend + nginx |
| `LOG_TO_FILE` | `false` | Log to stdout for Cloud Logging |
| `CLIENT_URL` | `FRONTEND_URL` | Email links; auto-added to the CORS allowlist |
| `API_PREFIX` | `/api/v1` | Must match `VITE_API_URL` |
| `COOKIE_SECURE` | `true` | |
| `COOKIE_SAME_SITE` | `lax` | `none` only for cross-origin |
| `ATTACHMENTS_DIR` | `/app/data/attachments` | **Ephemeral** — see §15 |
| `UPLOAD_DIR` | `/app/data/uploads` | **Ephemeral** — see §15 |
| `REQUIRE_EMAIL_VERIFICATION` | `true` | |
| `MAX_ACTIVE_SESSIONS`, `RATE_LIMIT_*`, `AUTH_RATE_LIMIT_*`, `BCRYPT_SALT_ROUNDS`, `JWT_*_EXPIRES_IN`, `JWT_ISSUER`, `JWT_AUDIENCE` | defaults are sane | Override only as needed |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `MAIL_FROM` | your mail provider | Password is a secret |

### Frontend

| Variable | Where | Notes |
|---|---|---|
| `VITE_API_URL` | Build arg | `/api/v1` — keep relative |
| `BACKEND_URL` | Runtime env var | Backend URL, **no trailing slash** |
| `MAX_UPLOAD_SIZE` | Runtime env var | `25m`; must exceed the API's own limit |

---

## 11. Secret Manager

Create secrets from a file, never as a shell argument — a `--data` flag lands in your shell history:

```bash
printf '%s' 'YOUR_MONGO_URI'        > /tmp/s && gcloud secrets create hrms-mongodb-uri        --data-file=/tmp/s --replication-policy=automatic
printf '%s' "$(openssl rand -base64 48)" > /tmp/s && gcloud secrets create hrms-jwt-access-secret  --data-file=/tmp/s --replication-policy=automatic
printf '%s' "$(openssl rand -base64 48)" > /tmp/s && gcloud secrets create hrms-jwt-refresh-secret --data-file=/tmp/s --replication-policy=automatic
printf '%s' 'YOUR_SMTP_PASSWORD'    > /tmp/s && gcloud secrets create hrms-smtp-password      --data-file=/tmp/s --replication-policy=automatic
rm -f /tmp/s
```

Generate the JWT secrets **on your own machine**, as above. They are not in this repository and must never be.

Grant the runtime service account read access:

```bash
PROJECT_NUMBER=$(gcloud projects describe PROJECT_ID --format='value(projectNumber)')
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for s in hrms-mongodb-uri hrms-jwt-access-secret hrms-jwt-refresh-secret hrms-smtp-password; do
  gcloud secrets add-iam-policy-binding $s \
    --member="serviceAccount:${RUN_SA}" --role="roles/secretmanager.secretAccessor"
done
```

### Secret vs. plain env var

| Value | Secret Manager? | Why |
|---|---|---|
| `MONGODB_URI` | **Yes** | Contains the database password |
| `JWT_ACCESS_SECRET` | **Yes** | Forges any user's session |
| `JWT_REFRESH_SECRET` | **Yes** | Same, long-lived |
| `SMTP_PASSWORD` | **Yes** | Mail-relay credential |
| `CLIENT_URL`, `TRUST_PROXY`, `NODE_ENV`, `COOKIE_*`, `LOG_*`, rate limits | No | Not sensitive; visible in the console anyway |

**Rotating a JWT secret signs out every user immediately.** Existing tokens fail verification. Do it deliberately.

---

## 12. MongoDB configuration

Use MongoDB Atlas. Cloud Run has no static outbound IP by default, so Atlas IP allowlisting cannot identify it.

Two options:

**A — Allow all, rely on credentials + TLS (simplest).** Atlas → Network Access → `0.0.0.0/0`. Security rests entirely on the connection string, which is why it is in Secret Manager. Acceptable for many deployments; understand that it is a real trade.

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

**In the proxied setup, CORS does not apply.** The browser makes same-origin requests to the frontend; nginx forwards them server-side, where the same-origin policy has no jurisdiction. Nothing to configure.

The backend allowlist ([`backend/config/cors.js`](backend/config/cors.js)) still exists and still applies to any direct call. `CLIENT_URL` is folded into it automatically, and `CORS_ALLOW_LAN` is forced off when `NODE_ENV=production`.

### Why not point the bundle straight at the backend?

You can (`_VITE_API_URL=https://hrms-backend-xxx.a.run.app/api/v1`), but then:

- The refresh token cookie becomes **third-party**. Safari blocks it outright; Chrome is phasing it out. Sessions stop refreshing and users are logged out every 15 minutes with no error to explain it.
- It requires `COOKIE_SAME_SITE=none` and `COOKIE_SECURE=true`.
- The backend URL is frozen into the bundle — moving the API means a rebuild.

The proxy avoids all three. Only go direct if you have a specific reason.

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
| Boot error `Missing required environment variable` | A mandatory var is unset | The message names it. Check `--update-secrets` ran |
| Every `/api` route 404s | `BACKEND_URL` has a trailing slash | Remove it; nginx strips `/api/` otherwise |
| 502 from the frontend on `/api` | Backend rejecting the proxy, or down | `curl BACKEND_URL/health` directly |
| Login works, user logged out ~15 min later | Refresh cookie rejected | Should not happen when proxied. If direct: needs `SameSite=none` + `Secure` (§13) |
| Uploads fail with 413 | nginx body limit below the app's | Raise `MAX_UPLOAD_SIZE` |
| Uploaded files vanish after a deploy | Ephemeral filesystem | Expected. §15 |
| Everyone 429s at once | `TRUST_PROXY` too low — all users share one bucket | Set `TRUST_PROXY=2` |
| CORS rejection in the browser console | Direct cross-origin call | Set `CLIENT_URL` to the exact frontend origin |
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
Cloud Build (per trigger)
   ├─ docker build   (--cache-from :latest)
   ├─ push :SHORT_SHA and :latest to Artifact Registry
   └─ gcloud run deploy --image ...:SHORT_SHA
   │
   ▼
Cloud Run creates a revision, health-checks it, shifts traffic
   └─ Fails the check → traffic stays on the previous revision
```

A failed build or a revision that will not start **cannot take production down** — traffic only moves to a revision that started successfully.
