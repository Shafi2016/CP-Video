/**
 * Session-based Secret Manager for user-specific secret isolation
 * Prevents secret key leakage between users and blog sessions
 */

export interface UserSecret {
  name: string;
  value: string;
  createdAt: Date;
}

export interface SecretSession {
  sessionId: string;
  userId?: string;
  blogId?: string;
  secrets: Map<string, UserSecret>;
  createdAt: Date;
  lastAccessed: Date;
}

class SecretManager {
  private sessions = new Map<string, SecretSession>();
  private readonly SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired sessions every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60 * 60 * 1000);
  }

  /**
   * Create a new secret session for a user/blog
   */
  createSession(sessionId: string, userId?: string, blogId?: string): SecretSession {
    const session: SecretSession = {
      sessionId,
      userId,
      blogId,
      secrets: new Map(),
      createdAt: new Date(),
      lastAccessed: new Date()
    };
    
    this.sessions.set(sessionId, session);
    console.log(`🔐 Created secret session: ${sessionId} (user: ${userId}, blog: ${blogId})`);
    return session;
  }

  /**
   * Get or create a session
   */
  getOrCreateSession(sessionId: string, userId?: string, blogId?: string): SecretSession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = this.createSession(sessionId, userId, blogId);
    } else {
      session.lastAccessed = new Date();
    }
    return session;
  }

  /**
   * Add a secret to a specific session
   */
  addSecret(sessionId: string, name: string, value: string, userId?: string, blogId?: string): void {
    const session = this.getOrCreateSession(sessionId, userId, blogId);
    
    const secret: UserSecret = {
      name,
      value,
      createdAt: new Date()
    };
    
    session.secrets.set(name, secret);
    console.log(`🔑 Added secret "${name}" to session ${sessionId}`);
  }

  /**
   * Get secrets for a specific session
   */
  getSessionSecrets(sessionId: string): Map<string, UserSecret> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return new Map();
    }
    
    session.lastAccessed = new Date();
    return new Map(session.secrets);
  }

  /**
   * Get environment variables object for a specific session
   */
  getSessionEnvVars(sessionId: string): Record<string, string> {
    const secrets = this.getSessionSecrets(sessionId);
    const envVars: Record<string, string> = {};
    
    secrets.forEach((secret, name) => {
      envVars[name] = secret.value;
    });
    
    return envVars;
  }

  /**
   * Remove a session and all its secrets
   */
  removeSession(sessionId: string): boolean {
    const removed = this.sessions.delete(sessionId);
    if (removed) {
      console.log(`🗑️ Removed secret session: ${sessionId}`);
    }
    return removed;
  }

  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    let cleanedCount = 0;
    
    this.sessions.forEach((session, sessionId) => {
      if (now - session.lastAccessed.getTime() > this.SESSION_TIMEOUT) {
        this.sessions.delete(sessionId);
        cleanedCount++;
      }
    });
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} expired secret sessions`);
    }
  }

  /**
   * Get session info (without secrets)
   */
  getSessionInfo(sessionId: string): Omit<SecretSession, 'secrets'> | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    
    return {
      sessionId: session.sessionId,
      userId: session.userId,
      blogId: session.blogId,
      createdAt: session.createdAt,
      lastAccessed: session.lastAccessed
    };
  }

  /**
   * List all active sessions (for debugging)
   */
  listActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Shutdown cleanup
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.sessions.clear();
  }
}

// Global singleton instance
export const secretManager = new SecretManager();

// Graceful shutdown
process.on('SIGTERM', () => secretManager.shutdown());
process.on('SIGINT', () => secretManager.shutdown());
