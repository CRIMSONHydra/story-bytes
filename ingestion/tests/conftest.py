"""Shared fixtures for ingestion tests."""

import sys
from pathlib import Path

# Ensure the ingestion package is importable
_ingestion_root = Path(__file__).resolve().parent.parent
_project_root = _ingestion_root.parent

if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))
if str(_ingestion_root) not in sys.path:
    sys.path.insert(0, str(_ingestion_root))
