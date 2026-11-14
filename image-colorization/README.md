# AI Colorization Full-Stack Project

This project contains a complete backend and frontend structure for an image colorization website.

## Stack
- Backend: Flask, SQLAlchemy, JWT, CORS
- Database: SQLite by default (easy local run). Swap to PostgreSQL with `DATABASE_URL`
- Frontend: HTML, CSS, Vanilla JavaScript
- Inference: PyTorch + segmentation_models_pytorch

## Features
- Register / login / password reset token flow
- Upload grayscale image to backend
- Backend runs the colorization model
- Saves original and output images
- Stores user info, image info, feedback, preferences, password reset tokens, and activity logs
- User history page
- Admin dashboard with real backend stats

## Project structure

```text
colorization_fullstack/
├── backend/
│   ├── app.py
│   ├── config.py
│   ├── extensions.py
│   ├── requirements.txt
│   ├── models/
│   ├── routes/
│   ├── services/
│   ├── static/
│   │   ├── originals/
│   │   └── outputs/
│   └── instance/
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── README.md
```

## Native local startup (no Docker)

Run these commands from this project's directory. Use **Python 3.11 or 3.12**;
`numpy==1.26.4` in [requirements.txt](<backend/requirements.txt>) is unsuitable for Python 3.13.
Provide a compatible interpreter first if none is available; the launcher does not
install Python or packages. The old `venv/` may be a Windows environment and must
not be reused on macOS/Linux.

### 1) Create an isolated environment and explicitly install dependencies

```bash
python3.12 -m venv .venv  # python3.11 is also supported
.venv/bin/python -m pip install -r backend/requirements.txt
```

The project-local `.venv/` is already ignored by Git. Do not use global pip or
`sudo`. The install includes large PyTorch/ML packages; it is an explicit setup
step, never performed by the launcher. No native dependencies are bundled or
assumed installed.

### 2) Supply a trusted trained checkpoint for actual inference

The native launcher defaults to `backend/colorization_best.pth`. This checkpoint
is **not included**. Alternatively:

```bash
export MODEL_CHECKPOINT=/full/path/to/colorization_best.pth
```

Relative checkpoint paths resolve from this project directory. Use only trusted
checkpoints: the existing model loader uses `torch.load(..., weights_only=False)`.
The launcher overrides the backend's legacy Windows checkpoint setting in memory;
it does not change the backend or model implementation.

### 3) Check and start

```bash
sh ./run-native.sh --check
sh ./run-native.sh
```

The shell launcher always uses this project's `.venv/bin/python` and works from
any current directory when invoked by path. `--check` checks Python version,
dependency module presence and checkpoint existence without importing the backend,
creating database records, or binding a port. It exits nonzero for missing
prerequisites; file existence is not validation of model weights.

Open <http://127.0.0.1:5000>. The backend also serves the frontend: no separate
frontend process is needed. Startup binds **only loopback**, with debug and the
reloader disabled. Stop with Ctrl-C. If port 5000 is occupied (for example by
macOS AirPlay Receiver), stop that listener before retrying. This is a local
Flask development server, not a production deployment.

Without the checkpoint, startup warns and preserves the backend's existing
grayscale fallback; **this is not working colorization**. All native requirements
are still needed because ML modules are imported unconditionally. A passing
`/api/health` response only confirms the API, not model availability. No checkpoint
or model dependencies are downloaded by either launcher.

## Default seeded admin
If the database is empty, the app seeds:

- Email: `admin@example.com`
- Password: `admin123`

## Notes
- SQLite is used by default after native dependencies are installed; local data is stored in the ignored `backend/instance/` directory.
- To use PostgreSQL instead, set `DATABASE_URL` and separately provide its Python driver. Native startup does not require PostgreSQL or Docker.
- The current model service preserves your uploaded inference logic as closely as possible.
- A missing checkpoint produces grayscale passthrough, not actual inference. Missing `segmentation_models_pytorch` (or other imported dependencies) prevents startup.

## Main API routes

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

### Users
- `GET /api/users/me`
- `PUT /api/users/me`
- `PUT /api/users/preferences`
- `PUT /api/users/change-password`

### Images
- `POST /api/images/upload`
- `GET /api/images/my-history`
- `GET /api/images/<id>`
- `DELETE /api/images/<id>`

### Feedback
- `POST /api/feedback`
- `GET /api/feedback/me`

### Admin
- `GET /api/admin/stats`
- `GET /api/admin/users`
- `GET /api/admin/images`
- `GET /api/admin/feedback`
- `GET /api/admin/activity`
