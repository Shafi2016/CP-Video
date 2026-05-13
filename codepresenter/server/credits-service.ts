import fs from "fs";
import path from "path";

interface UserCreditsRecord {
  firebase_uid: string;
  email: string;
  display_name: string | null;
  total_credits: number;
  used_credits: number;
  is_trial: boolean;
  created_at: string;
  updated_at: string;
}

interface CreditTransactionRecord {
  id: string;
  firebase_uid: string;
  type: "trial_grant" | "purchase" | "usage" | "refund";
  amount: number;
  stripe_payment_id: string | null;
  description: string;
  created_at: string;
}

interface VideoExportRecord {
  id: string;
  firebase_uid: string;
  job_id: string;
  title: string;
  status: "queued" | "complete" | "error" | "refunded";
  credit_cost: number;
  created_at: string;
}

interface CreditsStore {
  users: Record<string, UserCreditsRecord>;
  transactions: CreditTransactionRecord[];
  exports: VideoExportRecord[];
}

const IS_CLOUD_RUN = !!process.env.K_SERVICE;
const STORE_PATH = path.join(process.cwd(), "data", "credits-store.json");

// Firestore reference (lazy-loaded in production)
let firestoreDb: any = null;

async function getFirestore(): Promise<any> {
  if (!IS_CLOUD_RUN) return null;
  if (firestoreDb) return firestoreDb;

  try {
    const mod = await import("firebase-admin");
    const admin = (mod as any).default ?? mod;
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId:
          process.env.FIREBASE_PROJECT_ID ||
          process.env.GOOGLE_CLOUD_PROJECT ||
          process.env.GCLOUD_PROJECT,
      });
    }
    firestoreDb = admin.firestore();
    return firestoreDb;
  } catch (error) {
    console.error("Firestore init failed, falling back to local:", error);
    return null;
  }
}

// ─── Local file storage (dev) ─────────────────────────────────────────────────

function loadLocalStore(): CreditsStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
    }
  } catch {}
  return { users: {}, transactions: [], exports: [] };
}

function saveLocalStore(store: CreditsStore): void {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

// ─── Credits Service ──────────────────────────────────────────────────────────

const TRIAL_CREDITS = 5;

export const creditsService = {
  /**
   * Get or create a user's credit record. New users get trial credits.
   */
  async getOrCreateUser(
    uid: string,
    email: string,
    displayName?: string
  ): Promise<UserCreditsRecord> {
    const db = await getFirestore();

    if (db) {
      // Firestore path
      const docRef = db.collection("user_credits").doc(uid);
      const doc = await docRef.get();

      if (doc.exists) {
        return doc.data() as UserCreditsRecord;
      }

      const newUser: UserCreditsRecord = {
        firebase_uid: uid,
        email,
        display_name: displayName || null,
        total_credits: TRIAL_CREDITS,
        used_credits: 0,
        is_trial: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await docRef.set(newUser);
      await db.collection("credit_transactions").add({
        firebase_uid: uid,
        type: "trial_grant",
        amount: TRIAL_CREDITS,
        stripe_payment_id: null,
        description: "Free trial credits",
        created_at: new Date().toISOString(),
      });

      return newUser;
    }

    // Local file path
    const store = loadLocalStore();
    if (store.users[uid]) return store.users[uid];

    const newUser: UserCreditsRecord = {
      firebase_uid: uid,
      email,
      display_name: displayName || null,
      total_credits: TRIAL_CREDITS,
      used_credits: 0,
      is_trial: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    store.users[uid] = newUser;
    store.transactions.push({
      id: `txn-${Date.now()}`,
      firebase_uid: uid,
      type: "trial_grant",
      amount: TRIAL_CREDITS,
      stripe_payment_id: null,
      description: "Free trial credits",
      created_at: new Date().toISOString(),
    });

    saveLocalStore(store);
    return newUser;
  },

  /**
   * Get remaining credits for a user.
   */
  async getBalance(uid: string): Promise<number> {
    const db = await getFirestore();

    if (db) {
      const doc = await db.collection("user_credits").doc(uid).get();
      if (!doc.exists) return 0;
      const data = doc.data() as UserCreditsRecord;
      return data.total_credits - data.used_credits;
    }

    const store = loadLocalStore();
    const user = store.users[uid];
    if (!user) return 0;
    return user.total_credits - user.used_credits;
  },

  /**
   * Check if user has enough credits, deduct 1, and record the export.
   * Returns { success, remaining, error? }
   */
  async deductCredit(
    uid: string,
    jobId: string,
    title: string
  ): Promise<{ success: boolean; remaining: number; error?: string }> {
    const db = await getFirestore();

    if (db) {
      const docRef = db.collection("user_credits").doc(uid);
      const doc = await docRef.get();

      if (!doc.exists) {
        return { success: false, remaining: 0, error: "User not found" };
      }

      const data = doc.data() as UserCreditsRecord;
      const remaining = data.total_credits - data.used_credits;

      if (remaining < 1) {
        return { success: false, remaining: 0, error: "Insufficient credits" };
      }

      await docRef.update({
        used_credits: data.used_credits + 1,
        updated_at: new Date().toISOString(),
      });

      await db.collection("credit_transactions").add({
        firebase_uid: uid,
        type: "usage",
        amount: -1,
        stripe_payment_id: null,
        description: `Video export: ${title}`,
        created_at: new Date().toISOString(),
      });

      await db.collection("video_exports").add({
        firebase_uid: uid,
        job_id: jobId,
        title,
        status: "queued",
        credit_cost: 1,
        created_at: new Date().toISOString(),
      });

      return { success: true, remaining: remaining - 1 };
    }

    // Local file path
    const store = loadLocalStore();
    const user = store.users[uid];

    if (!user) {
      return { success: false, remaining: 0, error: "User not found" };
    }

    const remaining = user.total_credits - user.used_credits;
    if (remaining < 1) {
      return { success: false, remaining: 0, error: "Insufficient credits" };
    }

    user.used_credits += 1;
    user.updated_at = new Date().toISOString();

    store.transactions.push({
      id: `txn-${Date.now()}`,
      firebase_uid: uid,
      type: "usage",
      amount: -1,
      stripe_payment_id: null,
      description: `Video export: ${title}`,
      created_at: new Date().toISOString(),
    });

    store.exports.push({
      id: `exp-${Date.now()}`,
      firebase_uid: uid,
      job_id: jobId,
      title,
      status: "queued",
      credit_cost: 1,
      created_at: new Date().toISOString(),
    });

    saveLocalStore(store);
    return { success: true, remaining: remaining - 1 };
  },

  /**
   * Refund a credit for a failed export.
   */
  async refundCredit(uid: string, jobId: string): Promise<void> {
    const db = await getFirestore();

    if (db) {
      const docRef = db.collection("user_credits").doc(uid);
      const doc = await docRef.get();
      if (!doc.exists) return;

      const data = doc.data() as UserCreditsRecord;
      await docRef.update({
        used_credits: Math.max(0, data.used_credits - 1),
        updated_at: new Date().toISOString(),
      });

      await db.collection("credit_transactions").add({
        firebase_uid: uid,
        type: "refund",
        amount: 1,
        stripe_payment_id: null,
        description: `Refund for failed export: ${jobId}`,
        created_at: new Date().toISOString(),
      });

      // Update export status
      const exportSnap = await db
        .collection("video_exports")
        .where("job_id", "==", jobId)
        .limit(1)
        .get();
      if (!exportSnap.empty) {
        await exportSnap.docs[0].ref.update({ status: "refunded" });
      }

      return;
    }

    // Local file path
    const store = loadLocalStore();
    const user = store.users[uid];
    if (!user) return;

    user.used_credits = Math.max(0, user.used_credits - 1);
    user.updated_at = new Date().toISOString();

    store.transactions.push({
      id: `txn-${Date.now()}`,
      firebase_uid: uid,
      type: "refund",
      amount: 1,
      stripe_payment_id: null,
      description: `Refund for failed export: ${jobId}`,
      created_at: new Date().toISOString(),
    });

    const exp = store.exports.find((e) => e.job_id === jobId);
    if (exp) exp.status = "refunded";

    saveLocalStore(store);
  },

  /**
   * Add purchased credits to a user's account.
   */
  async addCredits(
    uid: string,
    amount: number,
    stripePaymentId: string,
    description: string
  ): Promise<{ total: number; remaining: number }> {
    const db = await getFirestore();

    if (db) {
      const docRef = db.collection("user_credits").doc(uid);
      const doc = await docRef.get();

      if (!doc.exists) {
        return { total: 0, remaining: 0 };
      }

      const data = doc.data() as UserCreditsRecord;
      const newTotal = data.total_credits + amount;

      await docRef.update({
        total_credits: newTotal,
        is_trial: false,
        updated_at: new Date().toISOString(),
      });

      await db.collection("credit_transactions").add({
        firebase_uid: uid,
        type: "purchase",
        amount,
        stripe_payment_id: stripePaymentId,
        description,
        created_at: new Date().toISOString(),
      });

      return { total: newTotal, remaining: newTotal - data.used_credits };
    }

    // Local file path
    const store = loadLocalStore();
    const user = store.users[uid];
    if (!user) return { total: 0, remaining: 0 };

    user.total_credits += amount;
    user.is_trial = false;
    user.updated_at = new Date().toISOString();

    store.transactions.push({
      id: `txn-${Date.now()}`,
      firebase_uid: uid,
      type: "purchase",
      amount,
      stripe_payment_id: stripePaymentId,
      description,
      created_at: new Date().toISOString(),
    });

    saveLocalStore(store);
    return {
      total: user.total_credits,
      remaining: user.total_credits - user.used_credits,
    };
  },

  /**
   * Get transaction history for a user.
   */
  async getTransactions(uid: string): Promise<CreditTransactionRecord[]> {
    const db = await getFirestore();

    if (db) {
      const snap = await db
        .collection("credit_transactions")
        .where("firebase_uid", "==", uid)
        .orderBy("created_at", "desc")
        .limit(50)
        .get();

      return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
    }

    const store = loadLocalStore();
    return store.transactions
      .filter((t) => t.firebase_uid === uid)
      .reverse()
      .slice(0, 50);
  },
};
