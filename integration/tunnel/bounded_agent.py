#!/usr/bin/env python3
"""Bound the lifetime of one foreground child. Starting ngrok still needs action-time approval."""
import argparse
import os
import signal
import subprocess
import sys


def stop_owned(process):
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", required=True, type=int)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not 1 <= args.seconds <= 1800 or not command:
        parser.error("A foreground command and lifetime of 1–1800 seconds are required")
    def interrupted(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    try:
        process = subprocess.Popen(command, start_new_session=True)
    except OSError:
        print("Could not start the requested foreground agent", file=sys.stderr)
        return 1
    print(f"Owned agent PID {process.pid}; deadline {args.seconds}s; Ctrl+C stops this agent only", file=sys.stderr)
    try:
        return process.wait(timeout=args.seconds)
    except subprocess.TimeoutExpired:
        stop_owned(process)
        return 124
    except KeyboardInterrupt:
        stop_owned(process)
        return 130
    finally:
        stop_owned(process)

if __name__ == "__main__":
    sys.exit(main())
