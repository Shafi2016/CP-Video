# CodePresenter Repository

This repository now contains the standalone CodePresenter product in `codepresenter/`.

CodePresenter is a Gemma 4 powered teaching tool for Python notebooks. It lets users upload or create notebooks, execute code through Jupyter, present code character by character, generate instructor-style narration with Gemma 4, and export narrated teaching videos.

For the Kaggle Gemma 4 Good Hackathon demo, CodePresenter uses hosted Gemma 4 through the Gemini API by default. It also supports local Gemma models through Ollama for privacy-friendly and offline-oriented testing on machines with enough compute.

Key AI configuration lives in `codepresenter/.env.example`:

- `AI_PROVIDER=google-gemma` for hosted Gemma 4.
- `GEMMA_MODEL=gemma-4-31b-it` for the cloud teaching model.
- `GOOGLE_API_KEY`, `GEMINI_API_KEY`, or `GEMINI_GEMMA_API_KEY` for Gemini API access.
- `AI_PROVIDER=ollama-gemma`, `OLLAMA_BASE_URL`, and `OLLAMA_MODEL` for local Ollama testing.

```bash
cd codepresenter
npm install
npm run check
npm run build
npm run dev
```

The development server runs at `http://localhost:8080` by default.
