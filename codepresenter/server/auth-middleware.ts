import { Request, Response, NextFunction } from "express";

// Extend Express Request to include authenticated user info
declare global {
  namespace Express {
    interface Request {
      firebaseUser?: {
        uid: string;
        email: string;
        name?: string;
      };
    }
  }
}

let admin: any = null;
let adminInitialized = false;

async function getFirebaseAdmin() {
  if (adminInitialized) return admin;

  try {
    const mod = await import("firebase-admin");
    admin = (mod as any).default ?? mod;

    if (!admin.apps.length) {
      const projectId =
        process.env.FIREBASE_PROJECT_ID ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.GCLOUD_PROJECT;

      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId,
      });
    }
    adminInitialized = true;
    return admin;
  } catch (error) {
    console.error("Firebase Admin init failed:", error);
    return null;
  }
}

/**
 * Middleware that verifies Firebase ID tokens from the Authorization header.
 * Sets req.firebaseUser with { uid, email, name } on success.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const idToken = authHeader.slice(7);

  // In development without Firebase Admin, decode the token as a fallback
  const firebaseAdmin = await getFirebaseAdmin();
  if (!firebaseAdmin) {
    // Dev fallback: trust the token payload (base64-decode the JWT body)
    try {
      const payload = JSON.parse(
        Buffer.from(idToken.split(".")[1], "base64").toString()
      );
      req.firebaseUser = {
        uid: payload.user_id || payload.sub,
        email: payload.email || "dev@localhost",
        name: payload.name,
      };
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  }

  try {
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    req.firebaseUser = {
      uid: decoded.uid,
      email: decoded.email || "",
      name: decoded.name,
    };
    next();
  } catch (error: any) {
    console.error("Token verification failed:", error.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Optional auth - sets req.firebaseUser if token is present, but doesn't block.
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return next();
  }

  try {
    const idToken = authHeader.slice(7);
    const firebaseAdmin = await getFirebaseAdmin();

    if (!firebaseAdmin) {
      const payload = JSON.parse(
        Buffer.from(idToken.split(".")[1], "base64").toString()
      );
      req.firebaseUser = {
        uid: payload.user_id || payload.sub,
        email: payload.email || "dev@localhost",
        name: payload.name,
      };
    } else {
      const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
      req.firebaseUser = {
        uid: decoded.uid,
        email: decoded.email || "",
        name: decoded.name,
      };
    }
  } catch {
    // Silently ignore - user just won't be authenticated
  }
  next();
}
