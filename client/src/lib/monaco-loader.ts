// Dynamically load Monaco editor to reduce initial bundle size
let monacoPromise: Promise<any> | null = null;

export function loadMonaco() {
  if (!monacoPromise) {
    monacoPromise = new Promise(async (resolve, reject) => {
      try {
        // Load Monaco editor from CDN
        const monaco = await import('https://cdn.jsdelivr.net/npm/monaco-editor@0.39.0/esm/vs/editor/editor.api.js');
        
        // Load Python language support
        await import('https://cdn.jsdelivr.net/npm/monaco-editor@0.39.0/esm/vs/basic-languages/python/python.js');
        
        // Load Monaco themes
        const vsTheme = await (await fetch('https://cdn.jsdelivr.net/npm/monaco-editor@0.39.0/esm/vs/editor/editor.main.css')).text();
        const vsMonacoTheme = await (await fetch('https://cdn.jsdelivr.net/npm/monaco-editor@0.39.0/esm/vs/editor/standalone/browser/standalone-tokens.css')).text();
        
        // Add theme stylesheets
        const style = document.createElement('style');
        style.textContent = vsTheme + vsMonacoTheme;
        document.head.appendChild(style);

        resolve(monaco);
      } catch (error) {
        console.error('Failed to load Monaco editor:', error);
        reject(error);
      }
    });
  }
  
  return monacoPromise;
}
