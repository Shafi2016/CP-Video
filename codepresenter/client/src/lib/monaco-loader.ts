// Dynamically load Monaco editor to reduce initial bundle size
let monacoPromise: Promise<any> | null = null;

export function loadMonaco() {
  if (!monacoPromise) {
    monacoPromise = new Promise(async (resolve, reject) => {
      try {
        // Load Monaco editor from locally installed packagea
        const monaco = await import('monaco-editor');
        
        // Set custom options for Python syntax highlighting to match Jupyter
        monaco.editor.defineTheme('jupyter-python', {
          base: 'vs',
          inherit: true,
          rules: [
            { token: 'comment', foreground: '6a9955' },            // Comments in green
            { token: 'string', foreground: 'ce9178' },             // Strings in orange-red
            { token: 'keyword', foreground: '569cd6', fontStyle: 'bold' }, // Keywords in blue
            { token: 'number', foreground: 'b5cea8' },             // Numbers in light green
            { token: 'identifier', foreground: 'd4d4d4' },         // Identifiers in light grey
            { token: 'type', foreground: '4ec9b0' },               // Types in teal
            { token: 'delimiter', foreground: 'd4d4d4' },          // Delimiters in light grey
          ],
          colors: {
            'editor.foreground': '#d4d4d4',
            'editor.background': '#1e1e1e',
            'editor.selectionBackground': '#264f78',
            'editor.lineHighlightBackground': '#2a2a2a',
            'editorCursor.foreground': '#d4d4d4',
            'editorWhitespace.foreground': '#6e6e6e',
            'editorIndentGuide.background': '#2a2a2a',
            'editorIndentGuide.activeBackground': '#2a2a2a',
            'editorOverviewRuler.border': '#ffffff00',
            'editor.lineHighlightBorder': '#ffffff00',
            'editorLineNumber.foreground': '#6e6e6e',
            'editorLineNumber.activeForeground': '#d4d4d4'
          }
        });

        // Set dark theme too
        monaco.editor.defineTheme('jupyter-python-dark', {
          base: 'vs-dark',
          inherit: true,
          rules: [
            { token: 'comment', foreground: '6a9955' },           // Comments in green
            { token: 'string', foreground: 'ce9178' },            // Strings in red
            { token: 'keyword', foreground: '569cd6', fontStyle: 'bold' }, // Keywords in blue
            { token: 'number', foreground: 'b5cea8' },            // Numbers in light green
            { token: 'identifier', foreground: 'd4d4d4' },        // Identifiers in light grey
            { token: 'type', foreground: '4ec9b0' },              // Types in teal
            { token: 'delimiter', foreground: 'd4d4d4' },        // Delimiters in light grey
          ],
          colors: {
            'editor.foreground': '#d4d4d4',
            'editor.background': '#1e1e1e',
            'editor.selectionBackground': '#264f78',
            'editor.lineHighlightBackground': '#2d2d30',
            'editorCursor.foreground': '#d4d4d4',
            'editorWhitespace.foreground': '#3e3e42',
            'editorIndentGuide.background': '#1e1e1e',
            'editorIndentGuide.activeBackground': '#1e1e1e',
            'editorOverviewRuler.border': '#ffffff00',
            'editor.lineHighlightBorder': '#ffffff00',
            'editorLineNumber.foreground': '#6e6e6e',
            'editorLineNumber.activeForeground': '#d4d4d4'
          }
        });

        // Set as default theme
        monaco.editor.setTheme('jupyter-python');
        
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
