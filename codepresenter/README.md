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

## Cloud Run Deployment

The included `Dockerfile` and `cloudbuild.yaml` deploy the app as the existing Cloud Run service/image name `jupyter-server-launcher` in project `codepresenter2016`.

Recommended production domains:

- `https://present.ailivelearn.com`
- `https://cp.ailivelearn.com`

Before deploying, create or update Secret Manager secrets named:

- `GOOGLE_API_KEY`
- `OPENAI_API_KEY`
- `ACCESS_CODE`
- `JUPYTER_TOKEN`

From Google Cloud Shell or a local machine with `gcloud` installed:

```bash
cd codepresenter
gcloud config set project codepresenter2016
gcloud builds submit --config cloudbuild.yaml
```

Then map both custom domains to the Cloud Run service:

```bash
gcloud beta run domain-mappings create --service jupyter-server-launcher --domain present.ailivelearn.com --region us-central1
gcloud beta run domain-mappings create --service jupyter-server-launcher --domain cp.ailivelearn.com --region us-central1
```

Google Cloud will show the DNS records to add at your domain host. Keep `ACCESS_CODE` set for the Kaggle demo so the app is not openly usable.

## Firebase Hosting Frontend

For the lower-cost split deployment, keep the backend on Cloud Run and serve the React frontend from Firebase Hosting:

```bash
cd codepresenter
npm install
npm run build
firebase deploy --only hosting --project codepresenter2016
```

`firebase.json` serves `dist/public` statically and rewrites `/api/**`, `/uploads/**`, and render routes to the Cloud Run service `jupyter-server-launcher` in `us-central1`. The notebook WebSocket uses the Cloud Run URL from `/api/public-config`.

Connect `present.ailivelearn.com` and `cp.ailivelearn.com` in Firebase Hosting custom domains, not Cloud Run domain mappings, when using this split setup.
