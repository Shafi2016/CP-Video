// Google Drive integration utility
import { Notebook } from '@/types';

declare global {
  interface Window {
    gapi: any;
  }
}

export class GoogleDriveService {
  private static instance: GoogleDriveService;
  private isInitialized = false;

  static getInstance(): GoogleDriveService {
    if (!GoogleDriveService.instance) {
      GoogleDriveService.instance = new GoogleDriveService();
    }
    return GoogleDriveService.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Load Google APIs
    await this.loadGoogleAPIs();
    
    // For Firebase Auth users, we'll use a different approach
    // We'll use the Google Drive API directly with the user's access token
    // obtained through Firebase Auth
    
    this.isInitialized = true;
  }

  private loadGoogleAPIs(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.gapi) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onload = () => {
        window.gapi.load('client:auth2', () => {
          resolve();
        });
      };
      script.onerror = () => reject(new Error('Failed to load Google APIs'));
      document.head.appendChild(script);
    });
  }

  async saveNotebookToDrive(notebook: Notebook, userEmail: string, accessToken: string): Promise<string | null> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Use backend API to save notebook to Google Drive
      const response = await fetch('/api/google-drive/save-notebook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          notebook,
          userEmail,
          accessToken
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save to Google Drive');
      }

      const result = await response.json();
      
      // Open Google Drive in a new tab
      window.open('https://drive.google.com', '_blank');
      
      return result.fileId;
    } catch (error) {
      console.error('Failed to save notebook to Google Drive:', error);
      throw error;
    }
  }

  async saveNotebookAndOpenInColab(
    notebook: Notebook,
    userEmail: string,
    accessToken: string
  ): Promise<{ fileId: string; colabUrl: string; codePresenterUrl: string }> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const response = await fetch('/api/google-drive/save-notebook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notebook, userEmail, accessToken })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Failed to save notebook: ${err}`);
    }

    const result = await response.json();
    const { fileId, colabUrl, codePresenterUrl } = result;
    if (colabUrl) {
      window.open(colabUrl, '_blank');
    } else {
      window.open('https://drive.google.com', '_blank');
    }
    return { fileId, colabUrl, codePresenterUrl };
  }

  isConnected(): boolean {
    return localStorage.getItem('googleDriveConnected') === 'true';
  }

  getConnectedUser(): string | null {
    return localStorage.getItem('googleDriveUser');
  }

  disconnect(): void {
    localStorage.removeItem('googleDriveConnected');
    localStorage.removeItem('googleDriveUser');
  }
}

export const googleDriveService = GoogleDriveService.getInstance();
