# CodePresenter

Python CodePresenter is a focused Gemma 4 teaching app for the Kaggle hackathon.

Upload a Python notebook, execute it through Jupyter, generate per-cell teaching narration with Gemma 4, and export the result as a narrated lesson video.

## What Is Included

- Python notebook teaching and execution through the Jupyter kernel gateway.
- Notebook upload, list, open, save, and delete APIs.
- File manager APIs for notebook-side assets.
- Hosted Gemma 4 and optional local Ollama provider for teaching script generation.
- Video and audio export flows for notebook presentations.
- Credits, Stripe, Firebase auth, Google Drive, and voice APIs used by the Python notebook product.

## Development

```powershell
cd codepresenter
npm install
npm run check
npm run build
npm run dev
```

The app serves locally at `http://localhost:8080` by default.

## Environment

See `.env.example`. The server also looks for shared secrets in a sibling `keys/.env` folder when running from the standalone app.

Important variables:

- `GOOGLE_API_KEY`, `GEMINI_API_KEY`, or `GEMINI_GEMMA_API_KEY` for hosted Gemma 4 teaching narration.
- `AI_PROVIDER=google-gemma` for the default cloud Gemma provider.
- `GEMMA_MODEL=gemma-4-31b-it` for the hosted teaching model.
- `OLLAMA_BASE_URL` and `OLLAMA_MODEL` for optional local Gemma testing.
- `OPENAI_API_KEY` for voice/TTS.
- `ACCESS_CODE` for optional access gate.
- Firebase and Stripe variables for auth, credits, and payment flows.

Private key files and `.env` files must not be committed.

## Main Routes

- `/` public landing page
- `/code`, `/code/notebooks`, `/code/notebook/:id`, `/code/files`
- `/render/export`

Core APIs are mounted under `/api/notebooks`, `/api/files`, `/api/google-drive`, `/api/voice`, `/api/video`, `/api/credits`, and `/api/stripe`.
