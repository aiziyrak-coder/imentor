# salomatlik-ai monorepo

- `frontend/` — Vite + React client
- `backend/` — Django REST API

## DevOps Stack (Final)
- Dockerized frontend (`nginx`) + backend (`gunicorn`)
- `docker-compose.dev.yml` for local development
- `docker-compose.prod.yml` and `docker-compose.yml` for production-safe startup
- GitHub Actions CI for frontend (`lint/build`) and backend (`check --deploy`, `migrate`, `test`)
- Docker smoke-test job in CI (`build + up + health check`)
- OpenAPI/Swagger docs at `/api/docs/`
- JWT endpoints at `/api/v1/auth/token/` and `/api/v1/auth/token/refresh/`
- Versioned API at `/api/v1/...`
- Frontend prepared-content integration uses secured `/api/v1/prepared-content/`

## Start backend
```bash
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python manage.py migrate
.venv\Scripts\python manage.py runserver 0.0.0.0:8000
```

## Start frontend
```bash
cd frontend
npm install
npm run dev
```

Set `frontend/.env.local`:
```env
VITE_API_BASE_URL=http://localhost:8000/api
```

## Run with Docker Compose
```bash
docker compose -f docker-compose.dev.yml up --build
```

## Run production profile
```bash
set DJANGO_SECRET_KEY=your-long-secret
set DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1
set DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:3000
set DJANGO_CSRF_TRUSTED_ORIGINS=http://localhost:3000
docker compose -f docker-compose.prod.yml up --build
```

Frontend: `http://localhost:3000`  
Swagger: `http://localhost:3000/api/docs/`  

## Deploy (imentor.uz / api.imentor.uz)

Stack listens only on **127.0.0.1:31001** (frontend) and **127.0.0.1:31002** (API) so existing nginx vhosts and other apps stay isolated.

1. On GitHub, create an empty repo (e.g. `imentor`) and push this project (`git init`, `git remote add`, `git push`).
2. On the server: install Docker + Compose; clone the repo (SSH deploy key recommended).
3. `cp deploy/.env.production.example deploy/.env.production` and set `DJANGO_SECRET_KEY`, `GEMINI_API_KEY` (only on the server file — never in git), and hosts/CORS values.
4. `docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file deploy/.env.production up -d --build`
5. Add **new** nginx server blocks from `deploy/nginx/imentor.conf.example` (do not edit existing sites). Point DNS `A` records for `imentor.uz`, `www`, and `api.imentor.uz` to the server.
6. Issue TLS (e.g. `certbot --nginx -d imentor.uz -d www.imentor.uz -d api.imentor.uz`) and merge HTTPS `listen 443 ssl` blocks as certbot suggests.

Do **not** commit `.env` files or SSH passwords. Rotate any password that was shared in chat.

### Remote deploy from your PC (password or SSH key)

If OpenSSH to the server is not set up, you can still deploy with Paramiko (no manual SSH session):

1. `pip install -r deploy/requirements-deploy.txt`
2. Copy `deploy/.env.deploy.local.example` to `deploy/.env.deploy.local` and set `SSH_HOST`, `SSH_USER`, and either `SSH_PASSWORD` or ensure your public key is on the server and use `SSH_KEY_PATH` if the key is not the default.
3. On the server, create `deploy/.env.production` once (see `deploy/.env.production.example`) with `DJANGO_SECRET_KEY`, `GEMINI_API_KEY`, etc.
4. From the repo root: `python deploy/remote_deploy.py`

The script runs `git pull`, `docker compose`, uploads the nginx example, and reloads nginx. Use `python deploy/remote_deploy.py --dry-run` to view commands only.
