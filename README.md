# ಧ್ವನಿ (Dhwani) – Kannada Text to Speech

Paste Kannada text, select a voice preset, and listen or download an MP3. Dhwani uses Piper and the SYSPIN male Kannada voice. Synthesis runs on the same computer as Next.js, with no speech-service account or key.

## Start on this computer

The voice files and Python environment are already installed in this workspace. Open PowerShell in the project folder and run:

```powershell
pnpm.cmd dev
```

Open the local URL printed by Next.js. Select **Use sample text**, choose **Confident**, and press **Speak**. The player appears when the audio is ready. If the browser blocks autoplay, choose **Play**.

```text
ನಮಸ್ಕಾರ! ನಿಮ್ಮ ಹೆಸರು ಏನು? ನೀವು ಯಾವಾಗ ಊಟ ಮಾಡುತ್ತೀರಾ?
```

## Reinstall on Windows

Use Node.js 22 or newer, pnpm 11, and 64-bit Python 3.12. The one-time install downloads packages and the voice. Run these commands in the project folder:

```powershell
pnpm.cmd install
& .\scripts\setup-voice.ps1
pnpm.cmd dev
```

Pass `-Python "C:\path\to\python.exe"` to the setup script if Python is installed outside PATH. The script checks the pinned voice files against their SHA-256 hashes. Use `pnpm.cmd build` and `pnpm.cmd start` to run the production build locally.

## Voice and hosting

- The **Confident** preset uses −5% speed and −2 semitones. Piper sets the speaking rate and FFmpeg adjusts pitch and encodes the MP3. Kannada script gives the best results.
- Dhwani accepts up to 2,000 characters and preserves over-limit pastes for editing. The website reports progress by text segment. Long passages on the free host can take several minutes.
- The API validates text and prosody, processes one synthesis job at a time, and uses an in-memory audio cache and request limit. Clients can send `Prefer: respond-async` with a synthesis request. Follow a `202` response by polling `GET /api/tts?job=<jobId>` until it returns audio or an error. Passages over 350 characters always use this flow. Jobs live on a single server instance and are lost on restart. The browser voice remains available when the device supports Kannada.
- The model author recommends treating the [SYSPIN male Piper voice](https://huggingface.co/micahchoo/piper-kn) as non-commercial because of the source checkpoint terms. The training recordings are from [SYSPIN at IISc](https://syspin.iisc.ac.in/datasets).
- For personal self-hosting, build the included Dockerfile or keep Python, FFmpeg, and the model files available to the Node server. The Docker build downloads and verifies the voice files. Run the image with `docker run --rm -p 3000:3000 dhwani` after building it with `docker build -t dhwani .`.
- Rates and cache are per instance. Behind a trusted reverse proxy, configure `TRUSTED_CLIENT_IP_HEADER` only if the proxy overwrites the header with the verified IP and the Node port is private.

