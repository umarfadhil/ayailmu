import subprocess
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("bounded_agent.py")


class BoundedAgentTest(unittest.TestCase):
    def run_agent(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, timeout=8)

    def test_preserves_owned_child_exit(self):
        self.assertEqual(7, self.run_agent("--seconds", "2", "--", sys.executable, "-c", "raise SystemExit(7)").returncode)

    def test_stops_child_at_deadline(self):
        result = self.run_agent("--seconds", "1", "--", sys.executable, "-c", "import time; time.sleep(60)")
        self.assertEqual(124, result.returncode)

    def test_rejects_unbounded_duration_before_running_child(self):
        for value in ["0", "-1", "1801"]:
            result = self.run_agent("--seconds", value, "--", sys.executable, "-c", "raise SystemExit(99)")
            self.assertEqual(2, result.returncode)


if __name__ == "__main__":
    unittest.main()
