"""Pulls exactly the two digest-pinned PUBLIC images that infra/real-auth/real_auth_fixture.py declares, so the fixture helper
(which never pulls) finds them. Anonymous, with an empty throwaway DOCKER_CONFIG: no registry credential is read or sent.
An image already present is not pulled again. Every image must be present by its pinned reference afterwards, else exit 1.

    python3 -B -I infra/ci/precache-images.py
"""
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PULL_ATTEMPTS, PULL_TIMEOUT = 3, 600


def pinned_images():
    spec = importlib.util.spec_from_file_location("real_auth_fixture", REPO / "infra/real-auth/real_auth_fixture.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.POSTGRES_IMAGE, module.AUTH_IMAGE


def main():
    docker = os.environ.get("AYA_DOCKER") or shutil.which("docker")
    if not docker:
        sys.exit("precache-images: docker CLI not found (set AYA_DOCKER or put docker in PATH)")
    if sys.platform.startswith("linux") and not os.environ.get("DOCKER_HOST"):
        sys.exit("precache-images: DOCKER_HOST is not set; on Linux use unix:///var/run/docker.sock")
    with tempfile.TemporaryDirectory(prefix="aya-docker-config-") as config:
        env = dict(os.environ, DOCKER_CONFIG=config)
        for key in ("DOCKER_CONTEXT", "DOCKER_AUTH_CONFIG"):
            env.pop(key, None)

        def docker_run(*args, timeout=60):
            return subprocess.run([docker, *args], env=env, text=True, capture_output=True, timeout=timeout)

        for image in pinned_images():
            if docker_run("image", "inspect", "--format", "{{.Id}}", image).returncode == 0:
                print(f"cached: {image}")
                continue
            for attempt in range(1, PULL_ATTEMPTS + 1):
                print(f"pulling ({attempt}/{PULL_ATTEMPTS}): {image}", flush=True)
                try:
                    pulled = docker_run("pull", "--quiet", image, timeout=PULL_TIMEOUT)
                except subprocess.TimeoutExpired:
                    continue
                if pulled.returncode == 0:
                    break
            if docker_run("image", "inspect", "--format", "{{.Id}}", image).returncode != 0:
                sys.exit(f"precache-images: pinned image is not available after pulling: {image}")
            print(f"cached: {image}")


if __name__ == "__main__":
    main()
