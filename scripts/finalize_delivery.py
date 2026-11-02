#!/usr/bin/env python3
"""Create, verify, and receipt a fixed-length 4K/60 film delivery.

This script never overwrites an earlier run: each invocation creates a unique
delivery directory inside --out. It does not install software or use a remote
service. Parent visual review is always left pending.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable


SCRIPT_VERSION = "1.0.0"


class FinalizerError(RuntimeError):
    pass


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temp.replace(path)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def executable_path(value: str) -> Path:
    candidate = Path(value).expanduser()
    found = str(candidate) if candidate.exists() else shutil.which(value)
    if not found:
        raise FinalizerError(f"Executable not found: {value}")
    path = Path(found).resolve()
    if not path.is_file():
        raise FinalizerError(f"Executable path is not a file: {path}")
    return path


class Runner:
    def __init__(self, run_dir: Path, timeout: float, probe_timeout: float):
        self.run_dir = run_dir
        self.timeout = timeout
        self.probe_timeout = probe_timeout
        self.commands: list[dict[str, Any]] = []

    def logged(self, label: str, command: list[str], timeout: float | None = None) -> Path:
        log_path = self.run_dir / "logs" / f"{label}.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        if log_path.exists():
            log_path = log_path.with_name(f"{label}-{uuid.uuid4().hex[:8]}.log")
        record = {
            "label": label,
            "argv": command,
            "started_at": utc_now(),
            "log": str(log_path.relative_to(self.run_dir)),
        }
        started = time.monotonic()
        try:
            with log_path.open("wb") as log:
                completed = subprocess.run(
                    command,
                    stdin=subprocess.DEVNULL,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    timeout=timeout or self.timeout,
                    check=False,
                    shell=False,
                )
            record["returncode"] = completed.returncode
            if completed.returncode != 0:
                raise FinalizerError(
                    f"{label} failed with exit code {completed.returncode}; "
                    f"see {log_path}"
                )
            return log_path
        except subprocess.TimeoutExpired as exc:
            record["timed_out"] = True
            record["timeout_seconds"] = timeout or self.timeout
            raise FinalizerError(
                f"{label} exceeded its {timeout or self.timeout:g}s timeout; "
                f"partial log: {log_path}"
            ) from exc
        finally:
            record["elapsed_seconds"] = round(time.monotonic() - started, 3)
            record["finished_at"] = utc_now()
            self.commands.append(record)
            write_json(self.run_dir / "commands.json", self.commands)

    def probe(self, label: str, ffprobe: Path, media: Path, count_frames: bool = True) -> dict[str, Any]:
        cmd = [
            str(ffprobe), "-v", "error",
        ]
        cmd.extend(["-show_streams", "-show_format", "-of", "json", str(media)])
        log_path = self.logged(f"probe_{label}", cmd, self.probe_timeout)
        try:
            data = json.loads(log_path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError) as exc:
            raise FinalizerError(f"Could not parse ffprobe output for {media}; see {log_path}") from exc
        if count_frames:
            # FFprobe's software -count_frames can dominate a native4K pass.
            # Decode every actual frame on CUDA and count the passthrough output.
            decode_log = self.logged(f"gpu_decode_count_{label}", [
                str(self.ffmpeg), "-hide_banner", "-v", "error", "-xerror",
                "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
                "-i", str(media), "-map", "0:v:0", "-map", "0:a:0?",
                "-c:v", "wrapped_avframe", "-fps_mode", "passthrough",
                "-progress", "pipe:1", "-f", "null", "-",
            ])
            text = decode_log.read_text(encoding="utf-8", errors="replace")
            counts = re.findall(r"(?m)^frame=\s*(\d+)\s*$", text)
            if not counts or "progress=end" not in text:
                raise FinalizerError("No terminal CUDA decode/frame-count receipt")
            stream_of_type(data, "video")["nb_read_frames"] = counts[-1]
            data["actual_decode_count"] = {"device": "cuda", "frames": int(counts[-1]), "log": str(decode_log.relative_to(self.run_dir)), "audio_decoded_if_present": True}
        write_json(self.run_dir / "probes" / f"{label}.json", data)
        return data


def as_fraction(value: Any) -> Fraction | None:
    try:
        if value in (None, "", "N/A", "0/0"):
            return None
        return Fraction(str(value))
    except (ValueError, ZeroDivisionError):
        return None


def bitrate_number(value: str) -> int:
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([kKmMgG]?)\s*(?:b(?:it)?/s)?\s*", value)
    if not match:
        raise FinalizerError(f"Unsupported bitrate value: {value}")
    multiplier = {"": 1, "k": 1000, "m": 1_000_000, "g": 1_000_000_000}[match.group(2).lower()]
    return round(float(match.group(1)) * multiplier)


def stream_of_type(probe: dict[str, Any], codec_type: str) -> dict[str, Any] | None:
    return next((s for s in probe.get("streams", []) if s.get("codec_type") == codec_type), None)


def check_picture_source(probe: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    video = stream_of_type(probe, "video")
    if not video:
        raise FinalizerError("Picture input has no video stream")
    expected_frames = round(args.duration * args.fps)
    expected_rate = Fraction(args.fps, 1)
    actual_frames = int(video.get("nb_read_frames", -1))
    if (video.get("width"), video.get("height")) != (args.width, args.height):
        raise FinalizerError(
            f"Picture dimensions are {video.get('width')}x{video.get('height')}; "
            f"expected {args.width}x{args.height}"
        )
    if actual_frames != expected_frames:
        raise FinalizerError(f"Picture has {actual_frames} decoded frames; expected {expected_frames}")
    avg_rate = as_fraction(video.get("avg_frame_rate"))
    nominal_rate = as_fraction(video.get("r_frame_rate"))
    observed_rate = avg_rate or nominal_rate
    if avg_rate != expected_rate or nominal_rate != expected_rate:
        raise FinalizerError(
            f"Picture frame rates are average={avg_rate}, nominal={nominal_rate}; "
            f"both must equal {expected_rate} for stream copy"
        )
    duration = float(probe.get("format", {}).get("duration", "nan"))
    tolerance = max(1 / args.fps, 0.001)
    if not math.isfinite(duration) or abs(duration - args.duration) > tolerance:
        raise FinalizerError(
            f"Picture duration is {duration}; expected {args.duration}s within one video frame"
        )
    return {
        "width": args.width,
        "height": args.height,
        "fps": str(observed_rate),
        "decoded_frames": actual_frames,
        "nominal_duration_seconds": actual_frames / args.fps,
        "container_duration_seconds": duration,
    }


def parse_offsets(value: str, scene_seconds: float) -> tuple[float, float]:
    try:
        offsets = tuple(float(part.strip()) for part in value.split(","))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("sample offsets must be two comma-separated seconds") from exc
    if len(offsets) != 2 or any(not math.isfinite(x) for x in offsets) or offsets[0] == offsets[1] or any(x < 0 or x >= scene_seconds for x in offsets):
        raise argparse.ArgumentTypeError("provide exactly two distinct offsets within each scene")
    return (min(offsets), max(offsets))


def check_delivery_probe(
    probe: dict[str, Any], *, label: str, width: int, height: int,
    fps: int, frame_count: int, duration: float, audio_rate: int, channels: int,
    audio_bitrate: str,
) -> dict[str, Any]:
    video = stream_of_type(probe, "video")
    audio = stream_of_type(probe, "audio")
    if not video:
        raise FinalizerError(f"{label} has no video stream")
    if not audio:
        raise FinalizerError(f"{label} has no audio stream")
    actual_frames = int(video.get("nb_read_frames", -1))
    actual_rate = as_fraction(video.get("avg_frame_rate")) or as_fraction(video.get("r_frame_rate"))
    if (video.get("width"), video.get("height")) != (width, height):
        raise FinalizerError(
            f"{label} dimensions are {video.get('width')}x{video.get('height')}; expected {width}x{height}"
        )
    if actual_rate != Fraction(fps, 1):
        raise FinalizerError(f"{label} frame rate is {actual_rate}; expected {fps}/1")
    if actual_frames != frame_count:
        raise FinalizerError(f"{label} contains {actual_frames} decoded frames; expected {frame_count}")
    if video.get("codec_type") != "video":
        raise FinalizerError(f"{label} video stream metadata is invalid")
    if audio.get("sample_rate") != str(audio_rate):
        raise FinalizerError(f"{label} audio sample rate is {audio.get('sample_rate')}; expected {audio_rate}")
    if int(audio.get("channels", -1)) != channels:
        raise FinalizerError(f"{label} audio has {audio.get('channels')} channels; expected {channels}")
    if audio.get("codec_name") != "aac":
        raise FinalizerError(f"{label} audio codec is {audio.get('codec_name')}; expected AAC")
    measured_bitrate = int(audio.get("bit_rate", 0) or 0)
    target_bitrate = bitrate_number(audio_bitrate)
    if not measured_bitrate:
        raise FinalizerError(
            f"{label} AAC bitrate is unreported"
        )
    nominal = actual_frames / fps
    container_duration = float(probe.get("format", {}).get("duration", "nan"))
    # MP4 may expose the final AAC access unit's padding in container duration.
    duration_slop = max(1 / fps, 1024 / audio_rate) + 0.001
    if not math.isfinite(container_duration) or abs(container_duration - duration) > duration_slop:
        raise FinalizerError(
            f"{label} container duration is {container_duration}; target is {duration}s "
            f"(nominal video duration {nominal}s; allowed AAC/frame boundary {duration_slop:.6f}s)"
        )
    return {
        "width": width,
        "height": height,
        "fps": str(actual_rate),
        "decoded_frames": actual_frames,
        "nominal_video_duration_seconds": nominal,
        "container_duration_seconds": container_duration,
        "audio_codec": audio.get("codec_name"),
        "audio_sample_rate": int(audio["sample_rate"]),
        "audio_channels": int(audio["channels"]),
        "audio_target_bitrate": target_bitrate,
        "audio_measured_bitrate": measured_bitrate,
        "audio_bitrate_note": "AAC target is not a constant-rate requirement; low-complexity passages may use fewer bits.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--picture", required=True, type=Path, help="finished picture MP4")
    parser.add_argument("--mix", required=True, type=Path, help="final mix WAV")
    parser.add_argument("--captions", type=Path, help="optional SRT; muxed as mov_text and copied as a sidecar")
    parser.add_argument("--ffmpeg", required=True, help="path to local ffmpeg executable")
    parser.add_argument("--ffprobe", required=True, help="path to local ffprobe executable")
    parser.add_argument("--out", required=True, type=Path, help="output root; each run gets a unique child folder")
    parser.add_argument("--resume-from", type=Path, help="Resume a failed viewing-copy stage after a reviewed local fix; keep validated master and all earlier evidence")
    parser.add_argument("--duration", type=float, default=300.0)
    parser.add_argument("--fps", type=int, default=60)
    parser.add_argument("--width", type=int, default=3840)
    parser.add_argument("--height", type=int, default=2160)
    parser.add_argument("--preview-width", type=int, default=1920)
    parser.add_argument("--preview-height", type=int, default=1080)
    parser.add_argument("--audio-rate", type=int, default=48000)
    parser.add_argument("--audio-channels", type=int, default=2)
    parser.add_argument("--audio-bitrate", default="320k")
    parser.add_argument("--nvenc-preset", default="p5")
    parser.add_argument("--nvenc-cq", type=int, default=19)
    parser.add_argument("--scene-count", type=int, default=20)
    parser.add_argument("--scene-sample-offsets", default="3,11", help="two in-scene seconds, comma-separated")
    parser.add_argument("--contact-columns", type=int, default=5)
    parser.add_argument("--command-timeout", type=float, default=7200.0)
    parser.add_argument("--probe-timeout", type=float, default=240.0)
    args = parser.parse_args()

    if args.duration <= 0 or args.fps <= 0 or args.scene_count <= 0:
        parser.error("duration, fps, and scene count must be positive")
    if args.width <= 0 or args.height <= 0 or args.preview_width <= 0 or args.preview_height <= 0:
        parser.error("all output dimensions must be positive")
    if args.audio_rate <= 0 or args.audio_channels <= 0 or args.contact_columns <= 0:
        parser.error("audio settings and contact columns must be positive")
    if not 0 <= args.nvenc_cq <= 51:
        parser.error("NVENC CQ must be between 0 and 51")
    if args.preview_width % 2 or args.preview_height % 2 or args.width % 2 or args.height % 2:
        parser.error("H.264/NV12 output dimensions must be even")
    if args.command_timeout <= 0 or args.probe_timeout <= 0:
        parser.error("timeouts must be finite positive values")
    if not math.isfinite(args.duration) or not math.isfinite(args.command_timeout) or not math.isfinite(args.probe_timeout):
        parser.error("duration and timeouts must be finite")
    try:
        if bitrate_number(args.audio_bitrate) <= 0:
            parser.error("audio bitrate must be positive")
    except FinalizerError as exc:
        parser.error(str(exc))
    scene_seconds = args.duration / args.scene_count
    try:
        offsets = parse_offsets(args.scene_sample_offsets, scene_seconds)
    except argparse.ArgumentTypeError as exc:
        parser.error(str(exc))
    if round(offsets[0] * args.fps) == round(offsets[1] * args.fps):
        parser.error("sample offsets must resolve to two different frames at the selected fps")
    if abs(scene_seconds * args.fps - round(scene_seconds * args.fps)) > 1e-9:
        parser.error("each scene duration must contain an integer number of frames")

    args.picture = args.picture.expanduser().resolve()
    args.mix = args.mix.expanduser().resolve()
    args.captions = args.captions.expanduser().resolve() if args.captions else None
    args.out = args.out.expanduser().resolve()
    args.out.mkdir(parents=True, exist_ok=True)
    run_id = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    run_dir = args.out / f"delivery-{run_id}"
    prior_receipt = None
    if args.resume_from:
        run_dir = args.resume_from.resolve()
        if run_dir.parent != args.out:
            parser.error("resume directory must be a direct child of the selected output root")
        prior_receipt = json.loads((run_dir / "acceptance.json").read_text(encoding="utf-8"))
        if prior_receipt.get("status") not in {"STRUCTURE_FAIL_PARTIAL_OUTPUTS_PRESERVED", "LOCAL_VERIFICATION_REPAIR_PENDING"} or prior_receipt.get("current_stage") not in {"encode_1080p_viewing_copy", "probe_picture_input", "probe_and_full_decode_master"}:
            parser.error("Only the reviewed local probe/viewing-copy repair may be resumed")
        if prior_receipt.get("current_stage") == "encode_1080p_viewing_copy" and prior_receipt.get("stages", {}).get("validate_master_probe", {}).get("status") != "PASS":
            parser.error("Resume requires an already validated complete master")
        shutil.copyfile(run_dir / "acceptance.json", run_dir / f"acceptance-before-resume-{run_id}.json")
    else:
        run_dir.mkdir(parents=True, exist_ok=False)
        (run_dir / "frames").mkdir()

    receipt: dict[str, Any] = {
        "schema": "kelpie-finalizer-receipt-v1",
        "script_version": SCRIPT_VERSION,
        "run_id": run_id,
        "started_at": utc_now(),
        "input_paths": {
            "picture": str(args.picture),
            "mix": str(args.mix),
            "captions": str(args.captions) if args.captions else None,
        },
        "output_directory": str(run_dir),
        "target": {
            "duration_seconds": args.duration,
            "fps": args.fps,
            "master": [args.width, args.height],
            "preview": [args.preview_width, args.preview_height],
            "frames_per_delivery": round(args.duration * args.fps),
            "audio_rate": args.audio_rate,
            "audio_channels": args.audio_channels,
            "audio_bitrate": args.audio_bitrate,
            "scene_count": args.scene_count,
        },
        "automated_structural_acceptance": "IN_PROGRESS",
        "parent_visual_acceptance": "PENDING",
        "stages": {},
        "error": None,
    }
    receipt_path = run_dir / "acceptance.json"
    if prior_receipt:
        if prior_receipt["input_paths"] != receipt["input_paths"] or prior_receipt["target"] != receipt["target"]:
            parser.error("Resume inputs and delivery targets must match exactly")
        receipt = prior_receipt
        receipt.update(error=None, status="RESUMING_REVIEWED_VIEWING_COPY_FIX", parent_visual_acceptance="PENDING")
        receipt["resume_reason"] = "Use actual CUDA full-decode frame counts and keep CUDA frames resident into NVENC. Preserve all passed earlier stages and logs; no remote work is repeated."
    write_json(receipt_path, receipt)
    current_stage = "initialization"
    runner = Runner(run_dir, args.command_timeout, args.probe_timeout)
    if prior_receipt and (run_dir / "commands.json").exists():
        runner.commands = json.loads((run_dir / "commands.json").read_text(encoding="utf-8"))

    def stage(name: str, action: Callable[[], Any]) -> Any:
        nonlocal current_stage
        if prior_receipt and receipt["stages"].get(name, {}).get("status") == "PASS":
            return receipt["stages"][name].get("result")
        current_stage = name
        record: dict[str, Any] = {"status": "IN_PROGRESS", "started_at": utc_now()}
        receipt["stages"][name] = record
        write_json(receipt_path, receipt)
        started = time.monotonic()
        try:
            result = action()
            record["result"] = result
            record["status"] = "PASS"
            return result
        except Exception as exc:
            record["status"] = "FAIL"
            record["error"] = str(exc)
            raise
        finally:
            record["elapsed_seconds"] = round(time.monotonic() - started, 3)
            record["finished_at"] = utc_now()
            receipt["current_stage"] = current_stage
            write_json(receipt_path, receipt)

    def probe_and_decode(label: str, media: Path) -> dict[str, Any]:
        # probe() includes the complete CUDA video and audio decode/count pass.
        return runner.probe(label, ffprobe, media, count_frames=True)

    def media_exists() -> None:
        for label, path in (("picture", args.picture), ("mix", args.mix)):
            if not path.is_file():
                raise FinalizerError(f"{label} input does not exist: {path}")
        if args.captions and not args.captions.is_file():
            raise FinalizerError(f"captions input does not exist: {args.captions}")

    try:
        ffmpeg = executable_path(args.ffmpeg)
        ffprobe = executable_path(args.ffprobe)
        runner.ffmpeg = ffmpeg
        receipt["tool_paths"] = {"ffmpeg": str(ffmpeg), "ffprobe": str(ffprobe)}
        write_json(receipt_path, receipt)
        stage("input_paths", media_exists)

        def toolchain() -> dict[str, Any]:
            specs = [
                ("ffmpeg_version", [str(ffmpeg), "-version"]),
                ("ffprobe_version", [str(ffprobe), "-version"]),
                ("ffmpeg_filters", [str(ffmpeg), "-hide_banner", "-filters"]),
                ("ffmpeg_encoders", [str(ffmpeg), "-hide_banner", "-encoders"]),
                ("ffmpeg_hwaccels", [str(ffmpeg), "-hide_banner", "-hwaccels"]),
            ]
            texts: dict[str, str] = {}
            for label, cmd in specs:
                log = runner.logged(label, cmd, args.probe_timeout)
                texts[label] = log.read_text(encoding="utf-8", errors="replace")
            filters = texts["ffmpeg_filters"]
            encoders = texts["ffmpeg_encoders"]
            hwaccels = texts["ffmpeg_hwaccels"]
            capabilities = {
                "cuda_hwaccel": bool(re.search(r"(?m)^\s*cuda\s*$", hwaccels)),
                "scale_cuda": bool(re.search(r"\bscale_cuda\b", filters)),
                "h264_nvenc": bool(re.search(r"\bh264_nvenc\b", encoders)),
                "ffmpeg_version": next((x for x in texts["ffmpeg_version"].splitlines() if x.startswith("ffmpeg version")), "unknown"),
                "ffprobe_version": next((x for x in texts["ffprobe_version"].splitlines() if x.startswith("ffprobe version")), "unknown"),
            }
            write_json(run_dir / "toolchain.json", capabilities)
            missing = [key for key in ("cuda_hwaccel", "scale_cuda", "h264_nvenc") if not capabilities[key]]
            if missing:
                raise FinalizerError("Local FFmpeg lacks required CUDA/NVENC capability: " + ", ".join(missing))
            return capabilities

        capabilities = stage("toolchain_capabilities", toolchain)

        picture_probe = stage(
            "probe_picture_input",
            lambda: runner.probe("input_picture", ffprobe, args.picture, count_frames=True),
        )
        picture_facts = stage("validate_picture_input", lambda: check_picture_source(picture_probe, args))
        mix_probe = stage(
            "probe_mix_input",
            lambda: runner.probe("input_mix", ffprobe, args.mix, count_frames=False),
        )
        if "wav" not in str(mix_probe.get("format", {}).get("format_name", "")).split(","):
            raise FinalizerError("Final mix input is not identified by ffprobe as a WAV container")
        if not stream_of_type(mix_probe, "audio"):
            raise FinalizerError("Final mix WAV has no audio stream")
        captions_probe = None
        if args.captions:
            captions_probe = stage(
                "probe_captions_input",
                lambda: runner.probe("input_captions", ffprobe, args.captions, count_frames=False),
            )
            if not stream_of_type(captions_probe, "subtitle"):
                raise FinalizerError("Caption input does not probe as a subtitle stream")

        master = run_dir / "master-4k60.mp4"

        def mux_master() -> dict[str, Any]:
            cmd = [str(ffmpeg), "-hide_banner", "-y", "-i", str(args.picture), "-i", str(args.mix)]
            if args.captions:
                cmd.extend(["-i", str(args.captions)])
            cmd.extend(["-map", "0:v:0", "-map", "1:a:0"])
            if args.captions:
                cmd.extend(["-map", "2:s:0", "-c:s", "mov_text"])
            cmd.extend([
                "-c:v", "copy",
                "-c:a", "aac", "-b:a", args.audio_bitrate,
                "-ar", str(args.audio_rate), "-ac", str(args.audio_channels),
                "-af", f"aresample={args.audio_rate},apad=whole_dur={args.duration:g}",
                "-t", f"{args.duration:g}",
                "-movflags", "+faststart",
                "-metadata", "comment=Automated structural delivery; visual acceptance pending",
                str(master),
            ])
            runner.logged("mux_master", cmd)
            if args.captions:
                shutil.copy2(args.captions, run_dir / "captions.srt")
            return {"path": str(master.relative_to(run_dir)), "video_codec": "copied", "audio_codec": "aac"}

        stage("mux_4k_master", mux_master)
        master_probe = stage("probe_and_full_decode_master", lambda: probe_and_decode("master", master))
        master_facts = stage(
            "validate_master_probe",
            lambda: check_delivery_probe(
                master_probe, label="4K master", width=args.width, height=args.height,
                fps=args.fps, frame_count=round(args.duration * args.fps), duration=args.duration,
                audio_rate=args.audio_rate, channels=args.audio_channels, audio_bitrate=args.audio_bitrate,
            ),
        )
        if stream_of_type(master_probe, "video").get("codec_name") != stream_of_type(picture_probe, "video").get("codec_name"):
            raise FinalizerError("Master video codec differs from source; expected stream copy")
        if args.captions:
            subtitle = stream_of_type(master_probe, "subtitle")
            if not subtitle or subtitle.get("codec_name") != "mov_text":
                raise FinalizerError("Master is missing the requested mov_text subtitle stream")

        preview = run_dir / "viewing-1080p60.mp4"

        def make_preview() -> dict[str, Any]:
            cmd = [
                str(ffmpeg), "-hide_banner", "-y",
                "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
                "-i", str(master), "-map", "0:v:0", "-map", "0:a:0",
            ]
            if args.captions:
                cmd.extend(["-map", "0:s:0?", "-c:s", "copy"])
            cmd.extend([
                "-vf", f"scale_cuda={args.preview_width}:{args.preview_height}:format=nv12",
                "-r", str(args.fps), "-fps_mode", "cfr",
                "-c:v", "h264_nvenc", "-preset", args.nvenc_preset,
                "-rc", "vbr", "-cq", str(args.nvenc_cq), "-b:v", "0",
                "-profile:v", "high", "-pix_fmt", "cuda",
                "-c:a", "copy", "-t", f"{args.duration:g}",
                "-movflags", "+faststart", str(preview),
            ])
            runner.logged("encode_cuda_nvenc_preview", cmd)
            return {"path": str(preview.relative_to(run_dir)), "video_codec": "h264_nvenc", "cuda_decode_and_scale": True}

        stage("encode_1080p_viewing_copy", make_preview)
        preview_probe = stage("probe_and_full_decode_preview", lambda: probe_and_decode("preview", preview))
        preview_facts = stage(
            "validate_preview_probe",
            lambda: check_delivery_probe(
                preview_probe, label="1080p viewing copy", width=args.preview_width,
                height=args.preview_height, fps=args.fps,
                frame_count=round(args.duration * args.fps), duration=args.duration,
                audio_rate=args.audio_rate, channels=args.audio_channels, audio_bitrate=args.audio_bitrate,
            ),
        )
        if stream_of_type(preview_probe, "video").get("codec_name") != "h264":
            raise FinalizerError("Viewing copy codec is not H.264")
        if args.captions:
            subtitle = stream_of_type(preview_probe, "subtitle")
            if not subtitle or subtitle.get("codec_name") != "mov_text":
                raise FinalizerError("Viewing copy is missing the requested mov_text subtitle stream")

        sample_frames = round(args.duration * args.fps)
        scene_frames = round(scene_seconds * args.fps)
        frame_indices: list[int] = []
        for scene in range(args.scene_count):
            for offset in offsets:
                offset_frame = round(offset * args.fps)
                if offset_frame >= scene_frames:
                    raise FinalizerError(f"Sample offset {offset}s rounds outside its scene at {args.fps} fps")
                frame_indices.append(scene * scene_frames + offset_frame)
        if len(frame_indices) != args.scene_count * 2 or max(frame_indices) >= sample_frames:
            raise FinalizerError("Computed scene sample frame indices are outside the delivery")
        ff_expr = "+".join(f"eq(n\\,{index})" for index in frame_indices)
        frames_pattern = run_dir / "frames" / "sample-%03d.png"

        def extract_motion_frames() -> dict[str, Any]:
            cmd = [
                str(ffmpeg), "-hide_banner", "-y", "-i", str(master),
                "-vf", f"select='{ff_expr}'", "-fps_mode", "passthrough",
                "-frames:v", str(len(frame_indices)), "-start_number", "1",
                str(frames_pattern),
            ]
            runner.logged("extract_motion_frames", cmd, max(args.command_timeout, 900.0))
            frame_paths = sorted((run_dir / "frames").glob("sample-*.png"))
            if len(frame_paths) != args.scene_count * 2:
                raise FinalizerError(f"Extracted {len(frame_paths)} stills; expected {args.scene_count * 2}")
            import_result = {"count": len(frame_paths), "files": []}
            for i, frame_path in enumerate(frame_paths):
                scene = i // 2 + 1
                sample = i % 2 + 1
                labeled = frame_path.with_name(f"scene-{scene:02d}-sample-{sample}.png")
                frame_path.replace(labeled)
                import_result["files"].append(str(labeled.relative_to(run_dir)))
            return import_result

        frames_result = stage("extract_two_frames_per_scene", extract_motion_frames)

        def make_contact_sheet() -> dict[str, Any]:
            try:
                from PIL import Image, ImageDraw, ImageFont, ImageOps
            except ImportError as exc:
                raise FinalizerError("Pillow is required for the contact sheet; install it in the caller's environment") from exc
            frame_paths = sorted((run_dir / "frames").glob("scene-*-sample-*.png"))
            if len(frame_paths) != args.scene_count * 2:
                raise FinalizerError("Contact sheet source frame count is incomplete")
            columns = args.contact_columns
            rows = math.ceil(len(frame_paths) / columns)
            sheet_width = 1600
            margin, gap, label_h = 18, 10, 24
            tile_w = (sheet_width - 2 * margin - (columns - 1) * gap) // columns
            tile_h = round(tile_w * 9 / 16)
            cell_h = tile_h + label_h
            sheet = Image.new("RGB", (sheet_width, 2 * margin + rows * cell_h + (rows - 1) * gap), (14, 19, 31))
            draw = ImageDraw.Draw(sheet)
            resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
            try:
                font = ImageFont.truetype("arial.ttf", 15)
            except OSError:
                font = ImageFont.load_default()
            for i, frame_path in enumerate(frame_paths):
                with Image.open(frame_path) as source:
                    source.verify()
                with Image.open(frame_path) as source:
                    thumb = ImageOps.fit(source.convert("RGB"), (tile_w, tile_h), method=resampling)
                col, row = i % columns, i // columns
                x = margin + col * (tile_w + gap)
                y = margin + row * (cell_h + gap)
                sheet.paste(thumb, (x, y))
                scene = i // 2 + 1
                offset = offsets[i % 2]
                draw.text((x + 5, y + tile_h + 4), f"SCENE {scene:02d}  ·  {offset:g}s", fill=(224, 230, 245), font=font)
            contact = run_dir / "contact-sheet.jpg"
            sheet.save(contact, quality=92, subsampling=0, optimize=True)
            return {"path": str(contact.relative_to(run_dir)), "columns": columns, "rows": rows, "pixels": list(sheet.size)}

        contact_result = stage("build_contact_sheet", make_contact_sheet)

        def verify_review_assets() -> dict[str, Any]:
            from PIL import Image
            paths = sorted((run_dir / "frames").glob("scene-*-sample-*.png"))
            dimensions: dict[str, list[int]] = {}
            for path in paths + [run_dir / "contact-sheet.jpg"]:
                with Image.open(path) as image:
                    image.verify()
                with Image.open(path) as image:
                    dimensions[str(path.relative_to(run_dir))] = list(image.size)
            if len(paths) != args.scene_count * 2:
                raise FinalizerError("Review frame count changed during contact-sheet creation")
            return {"verified_images": len(dimensions), "dimensions": dimensions}

        review_assets = stage("verify_review_assets", verify_review_assets)

        def make_hashes() -> dict[str, Any]:
            inputs = {"picture": args.picture, "mix": args.mix}
            if args.captions:
                inputs["captions"] = args.captions
            outputs = {"master": master, "preview": preview, "contact_sheet": run_dir / "contact-sheet.jpg"}
            if args.captions:
                outputs["captions_sidecar"] = run_dir / "captions.srt"
            for path in sorted((run_dir / "frames").glob("scene-*-sample-*.png")):
                outputs[f"frame:{path.name}"] = path
            result = {
                "algorithm": "sha256",
                "inputs": {name: {"path": str(path), "sha256": sha256_file(path), "bytes": path.stat().st_size} for name, path in inputs.items()},
                "outputs": {name: {"path": str(path.relative_to(run_dir)), "sha256": sha256_file(path), "bytes": path.stat().st_size} for name, path in outputs.items()},
                "note": "Receipt files are not self-hashed; generated media and supplied inputs are covered.",
            }
            write_json(run_dir / "sha256.json", result)
            return result

        hash_result = stage("hash_deliverables", make_hashes)
        receipt["structural_summary"] = {
            "master": master_facts,
            "viewing_copy": preview_facts,
            "review_assets": {"frames": frames_result["count"], "contact_sheet": contact_result, "verified": review_assets["verified_images"]},
            "toolchain": capabilities,
            "picture_source": picture_facts,
        }
        receipt["hashes_file"] = "sha256.json"
        receipt["automated_structural_acceptance"] = "PASS"
        receipt["parent_visual_acceptance"] = "PENDING"
        receipt["status"] = "STRUCTURE_PASS_VISUAL_REVIEW_PENDING"
        receipt["finished_at"] = utc_now()
        write_json(receipt_path, receipt)
        print(json.dumps({"status": receipt["status"], "output_directory": str(run_dir), "acceptance": str(receipt_path)}, indent=2))
        return 0

    except KeyboardInterrupt:
        receipt["error"] = {"stage": current_stage, "type": "KeyboardInterrupt", "message": "Interrupted by operator"}
        receipt["automated_structural_acceptance"] = "INCOMPLETE"
        receipt["status"] = "INTERRUPTED_PARTIAL_OUTPUTS_PRESERVED"
        receipt["finished_at"] = utc_now()
        write_json(receipt_path, receipt)
        print(f"Interrupted; partial outputs and receipt preserved at {run_dir}", file=sys.stderr)
        return 130
    except Exception as exc:
        receipt["error"] = {"stage": current_stage, "type": type(exc).__name__, "message": str(exc)}
        receipt["automated_structural_acceptance"] = "FAIL"
        receipt["status"] = "STRUCTURE_FAIL_PARTIAL_OUTPUTS_PRESERVED"
        receipt["finished_at"] = utc_now()
        write_json(receipt_path, receipt)
        print(f"Finalization failed at {current_stage}: {exc}\nPartial outputs and receipt preserved at {run_dir}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
