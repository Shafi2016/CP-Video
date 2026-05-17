export interface RuntimeConfig {
  firebase?: {
    apiKey?: string;
    authDomain?: string;
    projectId?: string;
    storageBucket?: string;
    messagingSenderId?: string;
    appId?: string;
  };
  codePresenter?: {
    wsUrl?: string;
    cloudRunUrl?: string;
  };
}

let config: RuntimeConfig = {};
let configPromise: Promise<RuntimeConfig> | null = null;

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (configPromise) return configPromise;

  configPromise = (async () => {
    try {
      const response = await fetch("/api/public-config", { cache: "no-store" });
      if (response.ok) {
        config = await response.json();
      }
    } catch (error) {
      console.warn("Failed to load runtime config.", error);
    }
    return config;
  })();

  return configPromise;
}

export function getRuntimeConfig(): RuntimeConfig {
  return config;
}
