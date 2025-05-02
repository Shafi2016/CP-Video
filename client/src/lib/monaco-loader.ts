// Dynamically load Monaco editor to reduce initial bundle size
let monacoPromise: Promise<any> | null = null;

export function loadMonaco() {
  if (!monacoPromise) {
    monacoPromise = new Promise(async (resolve, reject) => {
      try {
        // Load Monaco editor from locally installed package
        const monaco = await import('monaco-editor');
        
        // Return the monaco object
        resolve(monaco);
      } catch (error) {
        console.error('Failed to load Monaco editor:', error);
        reject(error);
      }
    });
  }
  
  return monacoPromise;
}
