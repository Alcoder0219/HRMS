# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# HRMS web -- Vite build served by nginx.
#
# The critical thing about a Vite bundle: VITE_* values are substituted into
# the JavaScript at BUILD time and then frozen. Setting VITE_API_URL as a Cloud
# Run environment variable does nothing at all -- by then the string is already
# compiled into the shipped chunks. It is therefore a build argument here, and
# the API location the container talks to at runtime is nginx's ${BACKEND_URL}
# instead, which can change per deploy.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------- build
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
# Dev dependencies are required: vite and @vitejs/plugin-react are what perform
# the build, so --omit=dev here would fail outright.
RUN npm ci

COPY . .

# Relative by default, which is what makes the nginx proxy below the standard
# path: the browser calls the origin it loaded the app from, so there is no
# cross-origin request and no third-party cookie. Override only to point the
# bundle directly at an absolute API URL -- see DEPLOYMENT.md for what that
# then requires of CORS and cookies.
ARG VITE_API_URL=/api/v1
ARG VITE_APP_NAME=HRMS
ARG VITE_API_TIMEOUT=30000

ENV VITE_API_URL=$VITE_API_URL \
    VITE_APP_NAME=$VITE_APP_NAME \
    VITE_API_TIMEOUT=$VITE_API_TIMEOUT

# `--mode production` loads .env.production, then the ENV values above win.
RUN npm run build

# -------------------------------------------------------------------- runtime
FROM nginx:1.27-alpine AS runtime

# Read by the entrypoint's envsubst pass over the template. The default is a
# placeholder that fails loudly rather than quietly proxying somewhere wrong;
# Cloud Run must set BACKEND_URL to the API service's https URL.
ENV BACKEND_URL=http://backend-url-not-configured \
    MAX_UPLOAD_SIZE=25m

# Templates are rendered into /etc/nginx/conf.d at container start. The stock
# default.conf is removed so it cannot shadow the rendered one.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

# The base image's entrypoint runs the envsubst step and then execs this.
CMD ["nginx", "-g", "daemon off;"]
