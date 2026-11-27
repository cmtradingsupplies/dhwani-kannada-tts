"""Synthesize Kannada with Piper and encode the resulting audio as MP3."""

import json
import os
import subprocess
import sys
from pathlib import Path

from onnxruntime import InferenceSession, SessionOptions
from imageio_ffmpeg import get_ffmpeg_exe
from piper import PiperConfig, PiperVoice, SynthesisConfig


def main():
    request = json.load(sys.stdin.buffer)
    model = Path(__file__).resolve().parents[1] / "models" / "kn_IN-syspin_male-medium.onnx"
    options = SessionOptions()
    options.intra_op_num_threads = 1 if os.environ.get("RENDER") == "true" else 2
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    with model.with_suffix(".onnx.json").open(encoding="utf-8") as config:
        voice = PiperVoice(
            config=PiperConfig.from_dict(json.load(config)),
            session=InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"]),
        )
    sample_rate = voice.config.sample_rate
    settings = SynthesisConfig(length_scale=voice.config.length_scale / (1 + request["rate"] / 100))
    gap = bytes(int(sample_rate * 0.25) * 2)
    segments = []

    for index, text in enumerate(request["chunks"], start=1):
        for chunk in voice.synthesize(text, syn_config=settings):
            if chunk.audio_int16_bytes:
                segments.append(chunk.audio_int16_bytes)
        print(f"progress:{index}", file=sys.stderr, flush=True)

    if not segments:
        raise ValueError("No speech was generated")

    pitch_rate = round(sample_rate * 2 ** (request["pitch"] / 12))
    filters = (
        f"asetrate={pitch_rate},aresample={sample_rate},"
        f"atempo={sample_rate / pitch_rate:.8f},alimiter=limit=0.89:level=0:latency=1"
    )
    subprocess.run(
        [
            get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-filter_threads", "1",
            "-f", "s16le", "-ar", str(sample_rate), "-ac", "1", "-i", "pipe:0",
            "-af", filters, "-ar", "24000", "-codec:a", "libmp3lame", "-b:a", "96k",
            "-write_xing", "0", "-f", "mp3", "pipe:1",
        ],
        input=gap.join(segments),
        check=True,
    )


if __name__ == "__main__":
    main()
