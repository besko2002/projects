"""Native local entry point; leave the backend and model implementation unchanged."""
import argparse
import importlib.util
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent
DEPENDENCIES = (
    "flask", "flask_sqlalchemy", "flask_jwt_extended", "flask_cors",
    "werkzeug", "PIL", "numpy", "cv2", "torch", "segmentation_models_pytorch",
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="Check prerequisites without importing the app or starting a server")
    args = parser.parse_args()
    os.chdir(ROOT)
    checkpoint = Path(os.environ.get("MODEL_CHECKPOINT", "backend/colorization_best.pth"))
    checkpoint = checkpoint.expanduser().resolve()
    has_checkpoint = checkpoint.is_file()
    if not has_checkpoint:
        print(f"WARNING: checkpoint missing: {checkpoint}. Actual colorization is unavailable; "
              "the existing backend only returns grayscale fallback images.", file=sys.stderr)

    if sys.version_info[:2] not in ((3, 11), (3, 12)):
        print("Use Python 3.11 or 3.12 in .venv (numpy==1.26.4 does not support Python 3.13).",
              file=sys.stderr)
        return 1
    missing = [name for name in DEPENDENCIES if importlib.util.find_spec(name) is None]
    if missing:
        print("Missing native dependencies: " + ", ".join(missing), file=sys.stderr)
        print("Install explicitly: .venv/bin/python -m pip install -r backend/requirements.txt",
              file=sys.stderr)
        return 1
    if args.check:
        print("Native dependency modules found; checkpoint " +
              ("present (not validated)." if has_checkpoint else "missing."))
        return 0 if has_checkpoint else 1

    # Config currently contains a Windows-specific path and does not read this env var.
    # Override only for this entry point, before backend.app creates its global app.
    from backend.config import Config
    Config.MODEL_CHECKPOINT = str(checkpoint)
    from backend.app import app
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
