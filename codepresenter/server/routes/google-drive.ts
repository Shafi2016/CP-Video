import express from 'express';

const router = express.Router();

console.log('🔍 Google Drive routes module loaded');

// Save notebook to Google Drive using Firebase Auth token
router.post('/save-notebook', async (req, res) => {
  try {
    const { notebook, userEmail, accessToken } = req.body;

    if (!notebook || !userEmail || !accessToken) {
      return res.status(400).json({ error: 'Notebook data, user email, and access token required' });
    }

    // Convert notebook to Jupyter format
    const jupyterNotebook = {
      nbformat: 4,
      nbformat_minor: 2,
      metadata: {
        kernelspec: {
          display_name: "Python 3",
          language: "python",
          name: "python3"
        },
        language_info: {
          name: "python",
          version: "3.8.0"
        }
      },
      cells: notebook.cells.map((cell: any) => {
        // Split content into lines for proper Jupyter format
        const lines = cell.content ? cell.content.split('\n') : [''];
        const source = lines.map((line: string, index: number) => 
          index === lines.length - 1 ? line : line + '\n'
        );

        if (cell.type === 'code') {
          return {
            cell_type: "code",
            source: source,
            metadata: {},
            execution_count: null,
            outputs: []
          };
        } else {
          return {
            cell_type: "markdown",
            source: source,
            metadata: {}
          };
        }
      })
    };

    const fileName = `${notebook.title || 'Untitled Notebook'}.ipynb`;
    const fileContent = JSON.stringify(jupyterNotebook, null, 2);

    // Create file metadata
    const fileMetadata = {
      name: fileName,
      mimeType: 'application/json'
    };

    // Create multipart form data
    const boundary = '-------314159265358979323846';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";

    let body = delimiter +
      'Content-Type: application/json\r\n\r\n' +
      JSON.stringify(fileMetadata) + delimiter +
      'Content-Type: application/json\r\n\r\n' +
      fileContent + close_delim;

    // Upload to Google Drive using the access token
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary="${boundary}"`
      },
      body: body
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to upload to Drive: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    
    // Create Colab URL for better UX
    const colabUrl = `https://colab.research.google.com/drive/${result.id}`;
    
    // Generate the right link (dev vs prod)
    const BASE_URL = process.env.CODEPRESENTER_BASE_URL
      || `${req.protocol}://${req.get("host") || "localhost:8080"}`;
    
    const codePresenterUrl = `${BASE_URL.replace(/\/$/, "")}/code/open?src=drive&id=${result.id}`;

    // Note: Removed back-link to CodePresenter as it was causing redirect issues

    res.json({
      success: true,
      fileId: result.id,
      fileName: result.name,
      webViewLink: `https://drive.google.com/file/d/${result.id}/view`, // Drive preview (raw JSON)
      colabUrl,                                                          // Pretty notebook view
      codePresenterUrl                                                   // Return to CodePresenter
    });

  } catch (error) {
    console.error('Error saving to Google Drive:', error);
    res.status(500).json({ error: 'Failed to save notebook to Google Drive' });
  }
});

export default router;
