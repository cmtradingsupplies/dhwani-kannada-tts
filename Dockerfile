FROM node:22-bookworm-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@11.25.0

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY app ./app
COPY lib ./lib
COPY scripts/synthesize.py ./scripts/synthesize.py
COPY postcss.config.mjs tsconfig.json ./
RUN pnpm build && chown -R node:node .next

COPY requirements-voice.txt ./
RUN python3 -m venv .venv \
    && .venv/bin/python -m pip install --no-cache-dir -r requirements-voice.txt

RUN mkdir models \
    && base=https://huggingface.co/micahchoo/piper-kn/resolve/c73546cb70012e28f6093a61c71162924398fee1 \
    && model=kn_IN-syspin_male-medium.onnx \
    && curl -fsSL --retry 3 "$base/$model" -o "models/$model" \
    && curl -fsSL --retry 3 "$base/$model.json" -o "models/$model.json" \
    && printf '%s  %s\n' \
      bff423259625c0c1182e5b417f68560b6a55f3c4d27557a6abf2fbe51e7e00ee "models/$model" \
      feaf88702f1f045fdf4bd23606267344afb96141291de8a8118cdef125daf302 "models/$model.json" \
      | sha256sum -c -

USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
