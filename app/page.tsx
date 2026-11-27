"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { LOCALE, MAX_LENGTH, messages, signed, validateText, type ErrorCode } from "../lib/tts";

const presets = [
  { name: "Friendly", rate: 0, pitch: 0 },
  { name: "Confident", rate: -5, pitch: -2 },
  { name: "Warm storyteller", rate: -10, pitch: -1 },
];
const example = "ನಮಸ್ಕಾರ! ನಿಮ್ಮ ಹೆಸರು ಏನು? ನೀವು ಯಾವಾಗ ಊಟ ಮಾಡುತ್ತೀರಾ?";
const bars = [16, 28, 44, 31, 55, 73, 38, 23, 48, 64, 41, 85, 61, 32, 51, 71, 94, 70, 46, 60, 34, 46, 83, 66, 49, 29, 52, 65, 43, 34, 24, 14];

export default function Page() {
  const [text, setText] = useState("");
  const [rate, setRate] = useState(-5);
  const [pitch, setPitch] = useState(-2);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [fallback, setFallback] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [playHint, setPlayHint] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const [systemDark, setSystemDark] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setCanSpeak("speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
    const query = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(query.matches);
    sync();
    query.addEventListener("change", sync);
    try {
      const saved = localStorage.getItem("dhwani-theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {}
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!audioUrl) return;
    const player = audio.current;
    player?.play().catch((err: DOMException) => {
      if (err.name !== "AbortError") setPlayHint(true);
    });
    return () => URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  function toggleTheme() {
    const value = (theme ?? (systemDark ? "dark" : "light")) === "dark" ? "light" : "dark";
    setTheme(value);
    try { localStorage.setItem("dhwani-theme", value); } catch {}
  }

  function stopDeviceVoice() {
    if (utterance.current) {
      utterance.current = null;
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }

  function updateText(value: string) {
    stopDeviceVoice();
    setText(value);
    setError(null);
    setFallback(false);
  }

  async function speak(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    stopDeviceVoice();
    const invalid = validateText(text);
    setError(invalid);
    setFallback(false);
    if (invalid) {
      textarea.current?.focus();
      return;
    }
    audio.current?.pause();
    setPlayHint(false);
    setProgress(null);
    setBusy(true);
    try {
      let response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "respond-async" },
        body: JSON.stringify({ text, rate: signed(rate, "%"), pitch: signed(pitch, "st") }),
        signal: AbortSignal.timeout(90_000),
      });
      const deadline = Date.now() + 13 * 60_000;
      while (response.status === 202 && Date.now() < deadline) {
        const status = await response.json();
        if (typeof status.jobId !== "string") throw new Error("Invalid job");
        setProgress({ completed: status.completed, total: status.total });
        const url = `/api/tts?job=${encodeURIComponent(status.jobId)}`;
        // A brief connection loss does not cancel synthesis on the server.
        for (let attempt = 0; attempt < 4; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, attempt ? 5_000 : 2_000));
          try {
            response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
            if (![503, 504].includes(response.status)) break;
          } catch (error) {
            if (attempt === 3) throw error;
          }
        }
      }
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        const code = result?.code;
        setError(typeof code === "string" && Object.hasOwn(messages, code) ? code as ErrorCode : "unavailable");
        setFallback(response.status === 404 || response.status === 429 || response.status >= 500);
        return;
      }
      const mp3 = await response.blob();
      if (mp3.type !== "audio/mpeg" || !mp3.size) throw new Error("Invalid audio");
      setAudioUrl(URL.createObjectURL(mp3));
    } catch {
      setError("unavailable");
      setFallback(true);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function speakOnDevice() {
    if (speaking) {
      stopDeviceVoice();
      return;
    }
    const invalid = validateText(text);
    if (invalid) {
      setError(invalid);
      return;
    }
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    const voice = voices.find((item) => item.lang.replace("_", "-").toLowerCase() === "kn-in")
      ?? voices.find((item) => /^kn(?:[-_]|$)/i.test(item.lang));
    if (!voice) {
      setError("noVoice");
      return;
    }
    const speech = new SpeechSynthesisUtterance(text.trim());
    speech.lang = LOCALE;
    speech.voice = voice;
    speech.rate = 1 + rate / 100;
    speech.pitch = 2 ** (pitch / 12);
    speech.onend = () => {
      if (utterance.current === speech) stopDeviceVoice();
    };
    speech.onerror = () => {
      if (utterance.current !== speech) return;
      stopDeviceVoice();
      setError("noVoice");
    };
    utterance.current = speech;
    setSpeaking(true);
    setError(null);
    synth.speak(speech);
  }

  const dark = theme === "dark" || (theme === null && systemDark);

  return (
    <div className="shell mx-auto w-full">
      <header className="site-header flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="brand-icon" aria-hidden="true"><i/><i/><i/><i/><i/></span>
          <div className="wordmark"><span lang="kn">ಧ್ವನಿ</span><span className="brand-divider"/><span>Dhwani</span></div>
        </div>
        <button type="button" className="theme-button" onClick={toggleTheme} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>{dark ? "☀" : "☾"}</button>
      </header>

      <main>
        <section className="intro" aria-labelledby="title">
          <div>
            <p className="eyebrow">Kannada text to speech</p>
            <h1 id="title" lang="kn">ನಿಮ್ಮ ಅಕ್ಷರಗಳಿಗೆ<br/>ಧ್ವನಿ</h1>
            <p>Give your words a voice.</p>
          </div>
          <div className="waveform" aria-hidden="true">
            {bars.map((height, index) => <i key={index} style={{ height: `${height}%` }}/>)}
          </div>
        </section>

        <form className="studio" onSubmit={speak}>
          <section className="editor">
            <div className="section-title flex flex-wrap items-center justify-between gap-3">
              <label htmlFor="kannada-text">Your text</label>
              <button type="button" className="sample" disabled={busy} onClick={() => { updateText(example); textarea.current?.focus(); }}>Use sample text</button>
            </div>
            <textarea id="kannada-text" ref={textarea} lang="kn" value={text}
              onChange={(event) => updateText(event.target.value)} readOnly={busy}
              aria-describedby="text-count" aria-invalid={error === "empty" || error === "kannada" || error === "tooLong"}
              placeholder="ನೀವು ಕೇಳಲು ಬಯಸುವ ಕನ್ನಡ ಪಠ್ಯವನ್ನು ಇಲ್ಲಿ ಬರೆಯಿರಿ…" />
            <div className={text.length > MAX_LENGTH ? "counter over-limit" : "counter"} id="text-count">
              {text.length.toLocaleString("en-IN")} / {MAX_LENGTH.toLocaleString("en-IN")}
              {text.length > MAX_LENGTH && " · Over the limit"}
            </div>
          </section>

          <div className="settings">
            <div className="section-title flex items-center justify-between gap-2">
              <h2>Voice settings</h2><span className="voice-tag">Kannada · Male voice</span>
            </div>
            <fieldset disabled={busy}>
              <legend>Voice style</legend>
              <div className="presets">
                {presets.map((preset) => (
                  <label key={preset.name} className="preset">
                    <input type="radio" name="preset" checked={rate === preset.rate && pitch === preset.pitch}
                      onChange={() => { setRate(preset.rate); setPitch(preset.pitch); }} />
                    <span>{preset.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="sliders">
              <div>
                <div className="flex items-center justify-between"><label htmlFor="rate">Speed</label><output htmlFor="rate">{signed(rate, "%")}</output></div>
                <input type="range" id="rate" min="-20" max="20" value={rate} disabled={busy} aria-valuetext={`${rate} percent relative to normal`} onChange={(event) => setRate(event.target.valueAsNumber)} />
              </div>
              <div>
                <div className="flex items-center justify-between"><label htmlFor="pitch">Pitch</label><output htmlFor="pitch">{signed(pitch, "st")}</output></div>
                <input type="range" id="pitch" min="-4" max="4" value={pitch} disabled={busy} aria-valuetext={`${pitch} semitones relative to normal`} onChange={(event) => setPitch(event.target.valueAsNumber)} />
              </div>
            </div>
          </div>

          <div className="action-area">
            <button type="submit" className="speak" disabled={busy}>
              {busy ? "Generating audio…" : <><span aria-hidden="true" className="play-symbol"/><span lang="kn">ಮಾತನಾಡಿಸಿ</span><span className="speak-divider">/</span> Speak</>}
            </button>
            {busy && (
              <div className="generation-status" role="status">
                {progress ? (
                  <>
                    <progress value={progress.completed} max={progress.total} aria-label="Audio generation progress" />
                    <p>{progress.completed === progress.total
                      ? "Preparing your MP3…"
                      : `Converting text · ${progress.completed} of ${progress.total} parts complete`}</p>
                  </>
                ) : <p>Connecting to the speech server…</p>}
                <p>Keep this tab open. Long passages can take several minutes.</p>
              </div>
            )}
            {error && <p role="alert" className="error"><span lang="kn">{messages[error][0]}</span><span>{messages[error][1]}</span></p>}
            {fallback && canSpeak && (
              <button type="button" className="sample fallback" onClick={speakOnDevice}>
                {speaking ? "Stop device voice" : "Use device voice"}
              </button>
            )}
          </div>

          {audioUrl && (
            <section className="result" aria-labelledby="result-title">
              <div className="section-title flex flex-wrap items-center justify-between gap-2">
                <h2 id="result-title">{busy || error ? "Previous audio" : "Your audio"}</h2>
                <a className="sample" href={audioUrl} download="dhwani.mp3">Download MP3</a>
              </div>
              <audio ref={audio} src={audioUrl} controls preload="metadata" aria-label="Generated Kannada audio" onPlay={() => setPlayHint(false)} onError={() => setError("playback")}/>
              {playHint && <p role="status">Select play to hear your audio.</p>}
            </section>
          )}
        </form>
      </main>

      <footer className="site-footer flex flex-wrap justify-between gap-2">
        <span>Audio is AI-generated.</span>
        <span lang="kn">ಈ ಧ್ವನಿಯನ್ನು ಕೃತಕ ಬುದ್ಧಿಮತ್ತೆಯಿಂದ ರಚಿಸಲಾಗಿದೆ.</span>
      </footer>
    </div>
  );
}
