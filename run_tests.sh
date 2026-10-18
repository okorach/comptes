#!/bin/bash
# Unit tests with coverage (coverage.xml is consumed by SonarCloud)
cd "$(dirname "$0")" || exit 1
python -m coverage run --branch --source=comptes -m unittest discover -s tests -p "test_*.py" -v || exit 1
python -m coverage xml -o coverage.xml
python -m coverage report
