import { getGoogleApiKey, isGoogleApiKeyPresent } from "../config";

export type TeachingProviderName = "google-gemma" | "ollama-gemma" | "openai";

export interface TeachingScriptProviderRequest {
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  provider?: TeachingProviderName | "auto";
  model?: string;
}

export interface TeachingScriptProviderResponse {
  text: string;
  provider: TeachingProviderName;
  model: string;
}

export interface TeachingProviderStatus {
  provider: TeachingProviderName | "auto";
  activeProvider: TeachingProviderName;
  model: string;
  label: string;
  configured: boolean;
  localAvailable: boolean;
  cloudModels: TeachingModelOption[];
  localModels: TeachingModelOption[];
}

export interface TeachingModelOption {
  value: string;
  label: string;
  provider: "google-gemma" | "ollama-gemma";
}

const DEFAULT_GEMMA_MODEL = "gemma-4-31b-it";
const DEFAULT_GEMMA_MODELS = ["gemma-4-31b-it"];
const DEFAULT_OLLAMA_MODEL = "gemma4:e2b";
const DEFAULT_OLLAMA_MODELS = ["gemma4:e2b", "gemma4:e4b", "gemma4"];
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

function parseModelList(value: string | undefined, fallback: string[]) {
  const models = (value || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return Array.from(new Set(models.length ? models : fallback));
}

function getConfiguredGoogleModels() {
  return parseModelList(process.env.GEMMA_MODELS, [process.env.GEMMA_MODEL || DEFAULT_GEMMA_MODEL, ...DEFAULT_GEMMA_MODELS]);
}

function getConfiguredOllamaModels() {
  return parseModelList(process.env.OLLAMA_MODELS, [process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL, ...DEFAULT_OLLAMA_MODELS]);
}

function toModelOptions(models: string[], provider: "google-gemma" | "ollama-gemma"): TeachingModelOption[] {
  return models.map((model) => ({
    value: model,
    label: provider === "google-gemma" ? model.replace(/^gemma-4-/, "Gemma 4 ") : model,
    provider,
  }));
}

export function normalizeTeachingProvider(value?: string): TeachingProviderName | "auto" {
  const provider = (value || "google-gemma").trim().toLowerCase();
  if (provider === "auto") return "auto";
  if (provider === "ollama-gemma" || provider === "ollama") return "ollama-gemma";
  if (provider === "openai") return "openai";
  return "google-gemma";
}

export function getTeachingProviderStatus(): TeachingProviderStatus {
  const provider = normalizeTeachingProvider(process.env.AI_PROVIDER);
  const localAvailable = Boolean(process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL);
  const activeProvider: TeachingProviderName =
    provider === "auto"
      ? isGoogleApiKeyPresent()
        ? "google-gemma"
        : "ollama-gemma"
      : provider;

  const model =
    activeProvider === "ollama-gemma"
      ? (process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL)
      : activeProvider === "google-gemma"
        ? (process.env.GEMMA_MODEL || DEFAULT_GEMMA_MODEL)
        : (process.env.OPENAI_TEACHING_MODEL || "openai-legacy-disabled");

  return {
    provider,
    activeProvider,
    model,
    label: activeProvider === "ollama-gemma" ? `Local Gemma 4 (${model})` : activeProvider === "google-gemma" ? `Gemma 4 (${model})` : model,
    configured: activeProvider === "google-gemma" ? isGoogleApiKeyPresent() : activeProvider === "ollama-gemma" ? localAvailable : Boolean(process.env.OPENAI_API_KEY),
    localAvailable,
    cloudModels: toModelOptions(getConfiguredGoogleModels(), "google-gemma"),
    localModels: toModelOptions(getConfiguredOllamaModels(), "ollama-gemma"),
  };
}

export async function generateTeachingScriptText(
  request: TeachingScriptProviderRequest,
): Promise<TeachingScriptProviderResponse> {
  const provider = normalizeTeachingProvider(request.provider || process.env.AI_PROVIDER);

  if (provider === "auto") {
    try {
      return await generateGoogleGemma(request);
    } catch (error) {
      console.warn("[AIProvider] Google Gemma failed in auto mode; trying local Ollama Gemma:", error);
      return generateOllamaGemma(request);
    }
  }

  if (provider === "ollama-gemma") {
    return generateOllamaGemma(request);
  }

  if (provider === "openai") {
    throw new Error("AI_PROVIDER=openai is reserved for legacy mode and is not used for the Gemma hackathon mode.");
  }

  return generateGoogleGemma(request);
}

async function generateGoogleGemma(
  request: TeachingScriptProviderRequest,
): Promise<TeachingScriptProviderResponse> {
  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    throw new Error("Google API key not configured. Set GOOGLE_API_KEY, GEMINI_API_KEY, GEMINI_GEMMA_API_KEY, a *_FILE env var, or place a key file under .keys/keys.");
  }

  const model = request.model?.trim() || process.env.GEMMA_MODEL || DEFAULT_GEMMA_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await postGoogleGemmaRequest(endpoint, apiKey, request);
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Google Gemma request failed with status ${response.status}: ${errorText.slice(0, 500)}`);
  }

  const json = await response.json() as any;
  const text = extractGeminiText(json);
  if (!text) {
    throw new Error("Google Gemma returned no text content");
  }

  return { text, provider: "google-gemma", model };
}

async function postGoogleGemmaRequest(
  endpoint: string,
  apiKey: string,
  request: TeachingScriptProviderRequest,
): Promise<Response> {
  const generationConfig: Record<string, unknown> = {
    temperature: 0.35,
    maxOutputTokens: request.maxOutputTokens,
    thinkingConfig: {
      thinkingLevel: "high",
    },
  };

  return fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: request.userPrompt }],
        },
      ],
      systemInstruction: {
        parts: [{ text: request.systemPrompt }],
      },
      generationConfig,
    }),
  });
}

async function generateOllamaGemma(
  request: TeachingScriptProviderRequest,
): Promise<TeachingScriptProviderResponse> {
  const baseUrl = (process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
  const model = request.model?.trim() || process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        system: request.systemPrompt,
        prompt: request.userPrompt,
        stream: false,
        options: {
          temperature: 0.35,
          num_predict: request.maxOutputTokens,
        },
      }),
    });
  } catch (error: any) {
    const causeCode = error?.cause?.code || error?.cause?.errors?.[0]?.code;
    if (causeCode === "ECONNREFUSED" || error?.message === "fetch failed") {
      throw new Error(
        `Local Ollama is not reachable at ${baseUrl}. Start Ollama first, then run "ollama pull ${model}" if the model is not installed. Cloud Gemma is still available by selecting Cloud Gemma 4.`,
      );
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Ollama Gemma request failed with status ${response.status}: ${errorText.slice(0, 500)}`);
  }

  const json = await response.json() as any;
  const text = typeof json?.response === "string" ? json.response.trim() : "";
  if (!text) {
    throw new Error("Ollama Gemma returned no text content");
  }

  return { text, provider: "ollama-gemma", model };
}

function extractGeminiText(response: any): string {
  const parts = response?.candidates?.flatMap((candidate: any) => candidate?.content?.parts || []) || [];
  return parts
    .map((part: any) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
}
