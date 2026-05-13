const hasFirebaseConfig = !!(
  import.meta.env.VITE_FIREBASE_API_KEY &&
  import.meta.env.VITE_FIREBASE_AUTH_DOMAIN &&
  import.meta.env.VITE_FIREBASE_PROJECT_ID
);

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app: any = null;
let auth: any = null;
let storage: any = null;
let googleProvider: any = null;
let initializationPromise: Promise<void> | null = null;

const initializeFirebase = async () => {
  if (!hasFirebaseConfig) {
    throw new Error("Firebase configuration is not available");
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    try {
      const firebaseAppPromise = import("firebase/app");
      const firebaseAuthPromise = import("firebase/auth");
      const firebaseStoragePromise = import("firebase/storage");

      const [
        { initializeApp },
        { getAuth: getFirebaseAuth, GoogleAuthProvider },
        { getStorage: getFirebaseStorage },
      ] = (await Promise.race([
        Promise.all([firebaseAppPromise, firebaseAuthPromise, firebaseStoragePromise]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Firebase import timeout")), 10000),
        ),
      ])) as any;

      app = initializeApp(firebaseConfig);
      auth = getFirebaseAuth(app);
      storage = getFirebaseStorage(app);

      googleProvider = new GoogleAuthProvider();
      googleProvider.addScope("https://www.googleapis.com/auth/drive.file");
      googleProvider.addScope("https://www.googleapis.com/auth/drive.metadata.readonly");
      googleProvider.setCustomParameters({
        prompt: "consent",
      });
    } catch (error) {
      initializationPromise = null;
      throw error;
    }
  })();

  return initializationPromise;
};

const getAuth = async () => {
  if (!hasFirebaseConfig) {
    return null;
  }

  try {
    await initializeFirebase();
    return auth;
  } catch (error) {
    console.error("Failed to get Firebase auth:", error);
    return null;
  }
};

const getStorage = async () => {
  if (!hasFirebaseConfig) {
    return null;
  }

  try {
    await initializeFirebase();
    return storage;
  } catch (error) {
    console.error("Failed to get Firebase storage:", error);
    return null;
  }
};

const getGoogleProvider = async () => {
  if (!hasFirebaseConfig) {
    return null;
  }

  try {
    await initializeFirebase();
    return googleProvider;
  } catch (error) {
    console.error("Failed to get Google provider:", error);
    return null;
  }
};

export { getAuth, getStorage, getGoogleProvider, hasFirebaseConfig };
