#!/bin/bash
# Static analysis (configuration in .flake8)
cd "$(dirname "$0")" || exit 1
python -m flake8 comptes tests
