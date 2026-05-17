const ACCESS_CODE_STORAGE_KEY = "codepresenter_access_code";

let fetchPatchInstalled = false;

function getStoredAccessCode() {
  try {
    return window.sessionStorage.getItem(ACCESS_CODE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function saveAccessCode(code: string) {
  try {
    window.sessionStorage.setItem(ACCESS_CODE_STORAGE_KEY, code);
  } catch {
    // Cookie auth can still work if sessionStorage is unavailable.
  }
}

export function clearAccessCode() {
  try {
    window.sessionStorage.removeItem(ACCESS_CODE_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function installAccessCodeFetchPatch() {
  if (fetchPatchInstalled || typeof window === "undefined") return;
  fetchPatchInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const isSameOriginApi = url.startsWith("/api/") || url.startsWith(`${window.location.origin}/api/`);
    const code = getStoredAccessCode();

    if (!isSameOriginApi || !code) {
      return originalFetch(input, init);
    }

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.has("X-Access-Code")) {
      headers.set("X-Access-Code", code);
    }

    return originalFetch(input, {
      ...init,
      headers,
      credentials: init?.credentials || "include",
    });
  };
}
