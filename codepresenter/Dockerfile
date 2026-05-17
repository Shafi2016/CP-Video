FROM node:22-bookworm-slim AS base

WORKDIR /app

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --include=dev
RUN npx playwright install --with-deps chromium

RUN python3 -m pip install --break-system-packages --no-cache-dir \
  ipykernel \
  jupyter \
  jupyter-client \
  jupyter-kernel-gateway \
  jupyter-server \
  matplotlib \
  numpy \
  openpyxl \
  pandas \
  pillow \
  scikit-learn \
  scipy \
  seaborn \
  traitlets \
  xgboost

COPY . .
RUN npm run build \
  && npm prune --omit=dev

ENV NODE_ENV=production

EXPOSE 8080

CMD ["npm", "run", "start"]
