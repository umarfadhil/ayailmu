#!/usr/bin/env python3
"""Pronunciation clips for AyaIlmu from the ElevenLabs text-to-speech API (INTERACTIONS_AUDIO.md §3.1).

Reads the voice scripts android/content/voice/<lang>.json (and <lang>.<topic>.json) and the voice choices android/content/voice/voices.json,
asks ElevenLabs for every clip that is new or changed, and writes
android/content/src/main/assets/audio/<lang>/<slug>.mp3 plus the index the app reads,
android/content/src/main/assets/audio/index.json = {"clips": {"ko/sagwa": "<fingerprint>"}}.

    py android\\tools\\voice_gen.py --dry-run           what would be generated, and how many characters (billing)
    py android\\tools\\voice_gen.py                     generate everything that is new or changed
    py android\\tools\\voice_gen.py --lang ko           only Korean
    py android\\tools\\voice_gen.py --only ko/sagwa --force     redo one clip
    py android\\tools\\voice_gen.py --check             scripts vs files vs index; exit 1 on problems

(python3 instead of py on macOS/Linux.) Python 3.8+ standard library only: nothing to pip install.

The API key is read ONLY from the environment variable ELEVENLABS_API_KEY. It is never printed, logged or written
anywhere by this tool. Never commit it. See android/content/voice/README.md.

Fingerprint of a clip = sha1(text + voice_id + model_id + json(voice_settings, sorted keys, compact)). A clip is
skipped when its mp3 exists and its index entry equals the current fingerprint; change the text, the voice, the
model or the settings and it is generated again. The index is rewritten (atomically, sorted) after every clip, so an
interrupted run keeps what it already paid for.
"""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import random
import re
import socket
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

KEY_RE = re.compile(r"^[a-z]{2}/[a-z0-9_]+$")
LANG_RE = re.compile(r"^[a-z]{2}$")
DEFAULT_ROOT = Path(__file__).resolve().parents[2]  # android/tools/voice_gen.py -> repo root
DEFAULT_API = "https://api.elevenlabs.io"
ENV_KEY = "ELEVENLABS_API_KEY"
RETRY_STATUS = {429, 500, 502, 503, 504}
# Models that ignore or reject `language_code` (API reference, "Create speech": not supported for multilingual_v2).
NO_LANGUAGE_CODE_PREFIXES = ("eleven_multilingual_v2", "eleven_monolingual", "eleven_multilingual_v1")


class Fatal(Exception):
    """Stop the whole run (bad key, no credits, no access): every further request would fail the same way."""


# ---------------------------------------------------------------------------------------------------------------
# Paths and files
# ---------------------------------------------------------------------------------------------------------------
class Paths:
    def __init__(self, root: Path):
        self.root = root
        self.voice = root / "android" / "content" / "voice"
        self.voices = self.voice / "voices.json"
        self.audio = root / "android" / "content" / "src" / "main" / "assets" / "audio"
        self.index = self.audio / "index.json"

    def clip_file(self, key: str) -> Path:
        lang, slug = key.split("/", 1)
        return self.audio / lang / f"{slug}.mp3"

    def rel(self, p: Path) -> str:
        try:
            return p.relative_to(self.root).as_posix()
        except ValueError:
            return str(p)


def read_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json_atomic(path: Path, data) -> None:
    """Write to a temp file in the same folder, then replace: a crash never leaves half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def write_bytes_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", suffix=".part", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


# ---------------------------------------------------------------------------------------------------------------
# Scripts, voices, index
# ---------------------------------------------------------------------------------------------------------------
class Clip:
    def __init__(self, key: str, text: str, note: str, source: str):
        self.key, self.text, self.note, self.source = key, text, note, source
        self.lang = key.split("/", 1)[0]


def load_scripts(paths: Paths):
    """All <lang>.json and <lang>.<topic>.json voice scripts. Returns (clips by key, problems as (lang or None, message))."""
    clips: dict[str, Clip] = {}
    problems: list[tuple[str | None, str]] = []
    if not paths.voice.is_dir():
        return clips, [(None, f"no voice script folder {paths.rel(paths.voice)}")]
    for f in sorted(paths.voice.glob("*.json")):
        if f.name == "voices.json":
            continue
        name = paths.rel(f)
        # <lang>.json or <lang>.<topic>.json (e.g. id.sejarah-k.json): several teams can each own a script file.
        stem = f.stem.split(".", 1)[0]
        try:
            data = read_json(f)
        except (OSError, ValueError) as e:
            problems.append((stem if LANG_RE.match(stem) else None, f"{name}: cannot read JSON ({e})"))
            continue
        if not isinstance(data, dict) or not isinstance(data.get("clips"), list):
            problems.append((stem, f'{name}: expected {{"lang": "{stem}", "clips": [...]}}'))
            continue
        lang = data.get("lang")
        if lang != stem or not LANG_RE.match(str(lang)):
            problems.append((stem, f'{name}: "lang" is {lang!r}, expected "{stem}" (the file name)'))
        for i, c in enumerate(data["clips"]):
            where = f"{name} clip #{i + 1}"
            if not isinstance(c, dict):
                problems.append((stem, f"{where}: not an object"))
                continue
            key, text = c.get("key"), c.get("text")
            if not isinstance(key, str) or not KEY_RE.match(key):
                problems.append((stem, f"{where}: invalid key {key!r} (must match {KEY_RE.pattern})"))
                continue
            if key.split("/", 1)[0] != stem:
                problems.append((stem, f"{where}: key {key} is not in language {stem}"))
                continue
            if not isinstance(text, str) or not text.strip():
                problems.append((stem, f"{where}: {key} has no text"))
                continue
            text = text.strip()
            old = clips.get(key)
            if old is not None:
                if old.text != text:
                    problems.append((stem, f"{where}: duplicate key {key} with a different text "
                                           f"({old.text!r} in {old.source} vs {text!r})"))
                continue  # same key, same text: harmless repeat
            clips[key] = Clip(key, text, str(c.get("note", "")), name)
    return clips, problems


def load_voices(paths: Paths) -> dict:
    if not paths.voices.exists():
        raise SystemExit(f"missing {paths.rel(paths.voices)} (model, settings and one voice id per language)")
    cfg = read_json(paths.voices)
    for field in ("model_id", "output_format", "voice_settings", "voices"):
        if field not in cfg:
            raise SystemExit(f"{paths.rel(paths.voices)}: missing {field!r}")
    return cfg


class Voice:
    """The effective settings for one language (global values, overridden per language where given)."""

    def __init__(self, cfg: dict, lang: str):
        v = cfg["voices"].get(lang) or {}
        self.lang = lang
        self.voice_id = str(v.get("voice_id") or "").strip()
        self.model_id = str(v.get("model_id") or cfg["model_id"])
        self.output_format = str(v.get("output_format") or cfg["output_format"])
        settings = dict(cfg.get("voice_settings") or {})
        settings.update(v.get("voice_settings") or {})
        self.voice_settings = settings
        self.language_code = str(v.get("language_code") or lang)
        send = cfg.get("send_language_code", True) and v.get("send_language_code", True)
        self.send_language_code = bool(send) and not self.model_id.startswith(NO_LANGUAGE_CODE_PREFIXES)

    def fingerprint(self, text: str) -> str:
        settings = json.dumps(self.voice_settings, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha1((text + self.voice_id + self.model_id + settings).encode("utf-8")).hexdigest()


def load_index(paths: Paths) -> dict[str, str]:
    if not paths.index.exists():
        return {}
    data = read_json(paths.index)
    clips = data.get("clips") if isinstance(data, dict) else None
    if not isinstance(clips, dict):
        raise SystemExit(f'{paths.rel(paths.index)}: expected {{"clips": {{...}}}}')
    return {str(k): str(v) for k, v in clips.items()}


def save_index(paths: Paths, index: dict[str, str]) -> None:
    write_json_atomic(paths.index, {"clips": dict(sorted(index.items()))})


# ---------------------------------------------------------------------------------------------------------------
# The API
# ---------------------------------------------------------------------------------------------------------------
def check_api_base(api_base: str) -> str:
    u = urllib.parse.urlparse(api_base)
    local = u.hostname in ("localhost", "127.0.0.1", "::1")
    if u.scheme != "https" and not (u.scheme == "http" and local):
        raise SystemExit(f"--api-base must be https:// (plain http only for localhost tests), got {api_base!r}")
    return api_base.rstrip("/")


def describe_error(status: int, body: bytes) -> str:
    """'invalid_api_key: Invalid API key' from ElevenLabs' {"detail": {...}} error body (never echoes headers)."""
    try:
        detail = json.loads(body.decode("utf-8", "replace")).get("detail")
    except (ValueError, AttributeError):
        text = body.decode("utf-8", "replace").strip()
        return text[:300] or f"HTTP {status}"
    if isinstance(detail, dict):
        code = detail.get("code") or detail.get("status") or detail.get("type") or ""
        msg = detail.get("message") or ""
        return (f"{code}: {msg}" if code else str(msg))[:300] or f"HTTP {status}"
    if isinstance(detail, list):  # 422 validation errors
        parts = []
        for d in detail[:3]:
            if isinstance(d, dict):
                loc = ".".join(str(x) for x in d.get("loc", []))
                parts.append(f"{loc}: {d.get('msg', '')}".strip(": "))
        return "; ".join(parts)[:300] or f"HTTP {status}"
    return str(detail)[:300] if detail else f"HTTP {status}"


def looks_like_audio(data: bytes, output_format: str) -> bool:
    if not data:
        return False
    if output_format.startswith("mp3"):
        return data[:3] == b"ID3" or (data[0] == 0xFF and (data[1] & 0xE0) == 0xE0)
    return True


def tts(api_base: str, api_key: str, voice: Voice, text: str, timeout: float, retries: int, backoff: float) -> bytes:
    """POST /v1/text-to-speech/{voice_id}?output_format=... ; returns the audio bytes.
    Retries 429/5xx and network errors with exponential backoff (honours Retry-After). Raises Fatal on 401/402/403
    and on 404 (unknown voice or model), ValueError on other 4xx (this clip only)."""
    url = (f"{api_base}/v1/text-to-speech/{urllib.parse.quote(voice.voice_id, safe='')}"
           f"?{urllib.parse.urlencode({'output_format': voice.output_format})}")
    body = {"text": text, "model_id": voice.model_id, "voice_settings": voice.voice_settings}
    if voice.send_language_code:
        body["language_code"] = voice.language_code
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg" if voice.output_format.startswith("mp3") else "*/*",
        "User-Agent": "ayailmu-voice-gen/1",
    }
    attempt = 0
    while True:
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        wait = None
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            if not looks_like_audio(data, voice.output_format):
                raise ValueError(f"the answer is not {voice.output_format} audio ({len(data)} bytes)")
            return data
        except urllib.error.HTTPError as e:
            status = e.code
            err = e.read() if e.fp is not None else b""
            reason = describe_error(status, err)
            if status == 401:
                raise Fatal(f"401 Unauthorized ({reason}). The API key in {ENV_KEY} was refused: check that it is set "
                            "in this terminal, copied whole, not revoked, and has text-to-speech permission.")
            if status in (402, 403):
                raise Fatal(f"{status} ({reason}). Check the plan, credits and the key's permissions.")
            if status == 404:
                raise Fatal(f"404 ({reason}). Check voice_id {voice.voice_id!r} and model_id {voice.model_id!r} "
                            "in voices.json.")
            if status not in RETRY_STATUS or attempt >= retries:
                raise ValueError(f"HTTP {status}: {reason}")
            ra = e.headers.get("Retry-After") if e.headers else None
            if ra:
                try:
                    wait = max(0.0, float(ra))
                except ValueError:
                    wait = None
            label = f"HTTP {status} ({reason})"
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, http.client.HTTPException) as e:
            if attempt >= retries:
                raise ValueError(f"network error: {getattr(e, 'reason', e)}")
            label = f"network error ({getattr(e, 'reason', e)})"
        if wait is None:
            wait = backoff * (2 ** attempt) + random.uniform(0, backoff / 2)
        attempt += 1
        print(f"    {label}; retry {attempt}/{retries} in {wait:.1f} s")
        time.sleep(wait)


# ---------------------------------------------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------------------------------------------
def select(clips: dict[str, Clip], langs: set[str] | None, only: set[str] | None) -> list[Clip]:
    out = [c for k, c in sorted(clips.items()) if (not langs or c.lang in langs) and (not only or k in only)]
    return out


def plan(paths: Paths, cfg: dict, chosen: list[Clip], index: dict[str, str], force: bool):
    """[(clip, voice, why)] for every chosen clip that needs generating."""
    todo = []
    for c in chosen:
        v = Voice(cfg, c.lang)
        f = paths.clip_file(c.key)
        if force:
            why = "forced"
        elif not f.exists():
            why = "new" if c.key not in index else "file missing"
        elif index.get(c.key) != v.fingerprint(c.text):
            why = "changed" if c.key in index else "not in index"
        else:
            continue
        todo.append((c, v, why))
    return todo


def cmd_check(paths: Paths, cfg: dict, clips: dict[str, Clip], script_problems, index: dict[str, str],
              langs: set[str] | None) -> int:
    def in_scope(lang):
        return not langs or lang in langs

    problems = [m for lang, m in script_problems if lang is None or in_scope(lang)]
    warnings = []
    for k in sorted(clips):
        c = clips[k]
        if not in_scope(c.lang):
            continue
        f = paths.clip_file(k)
        if not f.exists():
            problems.append(f"clip in script but no file: {k} -> {paths.rel(f)}")
        elif k not in index:
            problems.append(f"file not in index.json (the app will not play it): {paths.rel(f)}")
        else:
            v = Voice(cfg, c.lang)
            if v.voice_id and index[k] != v.fingerprint(c.text):
                warnings.append(f"stale: {k} was made with another text, voice, model or settings (run without --check)")
    for k in sorted(index):
        if not KEY_RE.match(k):
            problems.append(f"invalid key in index.json: {k!r}")
            continue
        if not in_scope(k.split("/", 1)[0]):
            continue
        if not paths.clip_file(k).exists():
            problems.append(f"index entry without file: {k} -> {paths.rel(paths.clip_file(k))}")
        if k not in clips:
            problems.append(f"index entry not in any voice script: {k}")
    if paths.audio.is_dir():
        for f in sorted(paths.audio.rglob("*")):
            if f.is_dir() or f == paths.index:
                continue
            rel = f.relative_to(paths.audio).as_posix()
            if f.suffix != ".mp3" or rel.count("/") != 1:
                problems.append(f"unexpected file in audio/: {paths.rel(f)}")
                continue
            key = rel[: -len(".mp3")]
            if not KEY_RE.match(key):
                problems.append(f"invalid clip file name: {paths.rel(f)} (key {key!r})")
            elif in_scope(key.split("/", 1)[0]) and key not in clips:
                problems.append(f"file without script: {paths.rel(f)}")
    used_langs = sorted({c.lang for c in clips.values() if in_scope(c.lang)})
    for lang in used_langs:
        if not Voice(cfg, lang).voice_id:
            warnings.append(f"no voice_id for {lang!r} in voices.json yet")
    n = sum(1 for c in clips.values() if in_scope(c.lang))
    have = sum(1 for c in clips.values() if in_scope(c.lang) and paths.clip_file(c.key).exists())
    print(f"{n} clips in scripts, {have} with files, {len(index)} in index.json")
    for w in warnings:
        print(f"  warning: {w}")
    for p in problems:
        print(f"  PROBLEM: {p}")
    if problems:
        kinds: dict[str, int] = {}
        for p in problems:
            kind = p.split(":", 1)[0] if not p.startswith("android/") else "voice script"
            kinds[kind] = kinds.get(kind, 0) + 1
        print(f"check: {len(problems)} problem(s): " + "; ".join(f"{k} x{n}" for k, n in sorted(kinds.items())))
    else:
        print("check: OK")
    return 1 if problems else 0


def cmd_generate(paths: Paths, cfg: dict, todo, index: dict[str, str], args) -> int:
    api_key = os.environ.get(ENV_KEY, "").strip()
    if not api_key:
        print(f"{ENV_KEY} is not set. In PowerShell, for this window only:\n"
              f'    $env:{ENV_KEY} = "<your key>"\n'
              "then run this again. (Use --dry-run to see what would be generated without a key.)", file=sys.stderr)
        return 2
    api_base = check_api_base(args.api_base)
    done = failed = chars = 0
    no_voice = sorted({c.lang for c, v, _ in todo if not v.voice_id})
    skipped_voice = sum(1 for _, v, _ in todo if not v.voice_id)
    if no_voice:
        print(f"  skipping {skipped_voice} clip(s): no voice_id in voices.json for {', '.join(no_voice)}")
    todo = [(c, v, why) for c, v, why in todo if v.voice_id]
    for i, (c, v, why) in enumerate(todo):
        if i and args.delay > 0:
            time.sleep(args.delay)
        print(f"  [{done + failed + 1}] {c.key} ({why}, {len(c.text)} chars)")
        try:
            audio = tts(api_base, api_key, v, c.text, args.timeout, args.retries, args.backoff)
        except Fatal as e:
            print(f"STOPPED: {e}", file=sys.stderr)
            print(f"{done} clip(s) written before the stop; index.json is up to date.", file=sys.stderr)
            return 3
        except ValueError as e:
            failed += 1
            print(f"    FAILED {c.key}: {e}")
            continue
        write_bytes_atomic(paths.clip_file(c.key), audio)
        index[c.key] = v.fingerprint(c.text)
        save_index(paths, index)
        done += 1
        chars += len(c.text)
    print(f"done: {done} written ({chars} characters), {failed} failed, {skipped_voice} skipped (no voice id)")
    if done:
        print("Every new clip must be listened to by a native speaker before release.")
    return 1 if failed or skipped_voice else 0


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):  # Hangul/kana/hanzi on a Windows console never crash the run
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description="Generate AyaIlmu pronunciation clips with ElevenLabs.")
    ap.add_argument("--dry-run", action="store_true", help="list what would be generated; no key, no requests")
    ap.add_argument("--check", action="store_true", help="compare scripts, files and index; exit 1 on problems")
    ap.add_argument("--lang", help="only these languages, comma-separated (e.g. ko or ko,ja)")
    ap.add_argument("--only", help="only these clip keys, comma-separated (e.g. ko/sagwa)")
    ap.add_argument("--force", action="store_true", help="generate the selected clips even if they are up to date")
    ap.add_argument("--delay", type=float, default=0.5, help="seconds between requests (default 0.5)")
    ap.add_argument("--retries", type=int, default=5, help="retries on 429/5xx/network errors (default 5)")
    ap.add_argument("--backoff", type=float, default=2.0, help="first retry wait in seconds, doubled each time")
    ap.add_argument("--timeout", type=float, default=60.0, help="seconds to wait for one answer (default 60)")
    ap.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="repository root (default: this checkout)")
    ap.add_argument("--api-base", default=DEFAULT_API, help=f"API base URL (default {DEFAULT_API}; tests only)")
    args = ap.parse_args(argv)

    paths = Paths(args.root.resolve())
    cfg = load_voices(paths)
    clips, script_problems = load_scripts(paths)
    index = load_index(paths)
    langs = {s.strip() for s in args.lang.split(",") if s.strip()} if args.lang else None
    only = {s.strip() for s in args.only.split(",") if s.strip()} if args.only else None
    if only:
        bad = sorted(k for k in only if not KEY_RE.match(k))
        if bad:
            raise SystemExit(f"--only: invalid key(s): {', '.join(bad)}")
        unknown = sorted(k for k in only if k not in clips)
        if unknown:
            raise SystemExit(f"--only: not in any voice script: {', '.join(unknown)}")

    if args.check:
        return cmd_check(paths, cfg, clips, script_problems, index, langs)

    chosen = select(clips, langs, only)
    chosen_langs = {c.lang for c in chosen} | (langs or set())
    # A broken script blocks the run when it concerns what was asked for (everything, when nothing was narrowed).
    blocking = [m for lang, m in script_problems
                if lang is None or (not langs and not only) or lang in chosen_langs]
    for lang, m in script_problems:
        print(f"  {'PROBLEM' if m in blocking else 'warning'}: {m}")
    if blocking:
        print("Fix the voice scripts first (nothing was generated).", file=sys.stderr)
        return 2
    todo = plan(paths, cfg, chosen, index, args.force)
    total = sum(len(c.text) for c, _, _ in todo)

    if args.dry_run:
        print(f"model {cfg['model_id']}, format {cfg['output_format']}")
        for c, v, why in todo:
            voice = v.voice_id or "NO VOICE YET"
            print(f"  {c.key:<28} {why:<13} {len(c.text):>4} chars  [{voice}]  {c.text}"
                  + (f"  ({c.note})" if c.note else ""))
        per_lang: dict[str, list[int]] = {}
        for c, _, _ in todo:
            per_lang.setdefault(c.lang, [0, 0])
            per_lang[c.lang][0] += 1
            per_lang[c.lang][1] += len(c.text)
        for lang, (n, ch) in sorted(per_lang.items()):
            print(f"  {lang}: {n} clip(s), {ch} characters")
        print(f"would generate {len(todo)} of {len(chosen)} selected clip(s): {total} characters "
              "(ElevenLabs bills by characters)")
        return 0

    if not todo:
        print(f"nothing to do: {len(chosen)} selected clip(s) are up to date")
        return 0
    print(f"generating {len(todo)} clip(s), {total} characters")
    return cmd_generate(paths, cfg, todo, index, args)


if __name__ == "__main__":
    sys.exit(main())
