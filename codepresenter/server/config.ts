// server/config.ts
// Helper utilities for configuration, including robust secret loading on Cloud Run
import fs from 'fs';
import path from 'path';

let cachedOpenAIKey: string | null | undefined;
let cachedGoogleApiKey: string | null | undefined;

const DEFAULT_SECRET_FILE = '/run/secrets/OPENAI_API_KEY';
const DEFAULT_GOOGLE_SECRET_FILE = '/run/secrets/GOOGLE_API_KEY';

/**
 * Clear the cached OpenAI key. Used after loading environment variables.
 */
export function clearOpenAIKeyCache(): void {
  cachedOpenAIKey = undefined;
}

export function clearGoogleApiKeyCache(): void {
  cachedGoogleApiKey = undefined;
}

/**
 * Returns the OpenAI API key from either environment or mounted secret file.
 * - First checks process.env.OPENAI_API_KEY
 * - If missing, checks OPENAI_API_KEY_FILE env var, then default Cloud Run path
 * The result is cached for the process lifetime.
 */
export function getOpenAIKey(): string | null {
  if (cachedOpenAIKey !== undefined) return cachedOpenAIKey;

  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (envKey) {
    cachedOpenAIKey = envKey;
    return cachedOpenAIKey;
  }

  const secretFile = process.env.OPENAI_API_KEY_FILE || DEFAULT_SECRET_FILE;
  try {
    if (fs.existsSync(secretFile)) {
      const fileKey = fs.readFileSync(secretFile, 'utf8').trim();
      cachedOpenAIKey = fileKey || null;
      return cachedOpenAIKey;
    }
  } catch (_e) {
    // ignore and fall through
  }

  cachedOpenAIKey = null;
  return cachedOpenAIKey;
}

function readFirstSecretFile(paths: string[]): string | null {
  for (const secretFile of paths) {
    try {
      if (secretFile && fs.existsSync(secretFile)) {
        const fileKey = fs.readFileSync(secretFile, 'utf8').trim();
        if (fileKey) return fileKey;
      }
    } catch (_e) {
      // ignore unreadable candidates and continue
    }
  }
  return null;
}

function getLocalKeyFileCandidates(): string[] {
  const names = [
    'GOOGLE_API_KEY',
    'GOOGLE_API_KEY.txt',
    'GOOGLE_AI_API_KEY',
    'GOOGLE_AI_API_KEY.txt',
    'GEMINI_API_KEY',
    'GEMINI_API_KEY.txt',
    'GEMINI_GEMMA_API_KEY',
    'GEMINI_GEMMA_API_KEY.txt',
    'GEMMA_API_KEY',
    'GEMMA_API_KEY.txt',
    'google_api_key',
    'google_api_key.txt',
    'gemini_api_key',
    'gemini_api_key.txt',
  ];
  const baseDirs = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '..', '..'),
    path.resolve(process.cwd(), '..', '..', 'keys'),
    path.resolve(process.cwd(), '..', '..', '..', 'keys'),
  ];

  return baseDirs.flatMap((baseDir) => [
    ...names.map((name) => path.join(baseDir, name)),
    ...names.map((name) => path.join(baseDir, '.keys', name)),
    ...names.map((name) => path.join(baseDir, 'keys', name)),
  ]);
}

/**
 * Returns a Google AI Studio / Gemini API key from env, an explicit *_FILE env,
 * Cloud Run secrets, or local .keys/keys folders. The key value is never logged.
 */
export function getGoogleApiKey(): string | null {
  if (cachedGoogleApiKey !== undefined) return cachedGoogleApiKey;

  for (const name of ['GOOGLE_API_KEY', 'GOOGLE_AI_API_KEY', 'GEMINI_API_KEY', 'GEMINI_GEMMA_API_KEY', 'GEMMA_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY']) {
    const envKey = process.env[name]?.trim();
    if (envKey) {
      cachedGoogleApiKey = envKey;
      return cachedGoogleApiKey;
    }
  }

  const explicitFiles = [
    process.env.GOOGLE_API_KEY_FILE,
    process.env.GOOGLE_AI_API_KEY_FILE,
    process.env.GEMINI_API_KEY_FILE,
    process.env.GEMINI_GEMMA_API_KEY_FILE,
    process.env.GEMMA_API_KEY_FILE,
    process.env.GOOGLE_GENERATIVE_AI_API_KEY_FILE,
    DEFAULT_GOOGLE_SECRET_FILE,
  ].filter((value): value is string => Boolean(value && value.trim()));

  cachedGoogleApiKey = readFirstSecretFile([...explicitFiles, ...getLocalKeyFileCandidates()]);
  return cachedGoogleApiKey;
}

/** Quick boolean to indicate Google Gemini/Gemma API presence for health checks. */
export function isGoogleApiKeyPresent(): boolean {
  const key = getGoogleApiKey();
  return !!(key && key.length > 0);
}

/** Quick boolean to indicate presence for health checks and logs. */
export function isOpenAIKeyPresent(): boolean {
  const key = getOpenAIKey();
  return !!(key && key.length > 0);
}
