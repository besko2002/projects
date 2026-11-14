#!/bin/sh
# Use only this project's native environment; never install packages implicitly.
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PYTHON="$PROJECT_DIR/.venv/bin/python"
if [ ! -x "$PYTHON" ]; then
    printf '%s\n' 'Missing native .venv. Create it with Python 3.11 or 3.12; see README.md.' >&2
    exit 1
fi
cd "$PROJECT_DIR"
exec "$PYTHON" "$PROJECT_DIR/native.py" "$@"
