import pytest
import sys

if __name__ == "__main__":
    exit_code = pytest.main(["tests/test_thermal_physics.py", "-v"])
    sys.exit(exit_code)
