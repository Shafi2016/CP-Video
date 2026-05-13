import { Router, Request, Response } from "express";
import { requireAuth } from "./auth-middleware";
import { creditsService } from "./credits-service";

const router = Router();

// Credit pack definitions
const CREDIT_PACKS: Record<string, { credits: number; name: string }> = {
  starter: { credits: 10, name: "Starter Pack (10 credits)" },
  standard: { credits: 30, name: "Standard Pack (30 credits)" },
  pro: { credits: 100, name: "Pro Pack (100 credits)" },
};

// Map env var price IDs to pack keys
function getPackByPriceId(priceId: string): { key: string; credits: number; name: string } | null {
  const mapping: Record<string, string> = {
    [process.env.STRIPE_PRICE_STARTER || ""]: "starter",
    [process.env.STRIPE_PRICE_STANDARD || ""]: "standard",
    [process.env.STRIPE_PRICE_PRO || ""]: "pro",
  };
  const key = mapping[priceId];
  if (!key || !CREDIT_PACKS[key]) return null;
  return { key, ...CREDIT_PACKS[key] };
}

let stripeInstance: any = null;

async function getStripe() {
  if (stripeInstance) return stripeInstance;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  const { default: Stripe } = await import("stripe");
  stripeInstance = new Stripe(secretKey);
  return stripeInstance;
}

/**
 * GET /api/credits/balance
 * Returns the user's credit balance and account info.
 */
router.get("/balance", requireAuth, async (req: Request, res: Response) => {
  try {
    const { uid, email, name } = req.firebaseUser!;
    const user = await creditsService.getOrCreateUser(uid, email, name);
    const remaining = user.total_credits - user.used_credits;

    res.json({
      total_credits: user.total_credits,
      used_credits: user.used_credits,
      remaining_credits: remaining,
      is_trial: user.is_trial,
    });
  } catch (error: any) {
    console.error("Failed to get balance:", error);
    res.status(500).json({ error: "Failed to retrieve credit balance" });
  }
});

/**
 * GET /api/credits/transactions
 * Returns the user's transaction history.
 */
router.get("/transactions", requireAuth, async (req: Request, res: Response) => {
  try {
    const { uid } = req.firebaseUser!;
    const transactions = await creditsService.getTransactions(uid);
    res.json({ transactions });
  } catch (error: any) {
    console.error("Failed to get transactions:", error);
    res.status(500).json({ error: "Failed to retrieve transactions" });
  }
});

/**
 * GET /api/credits/packs
 * Returns available credit packs for purchase.
 */
router.get("/packs", (_req: Request, res: Response) => {
  const packs = [
    {
      key: "starter",
      name: "Starter",
      credits: 10,
      price: 5,
      pricePerCredit: 0.5,
    },
    {
      key: "standard",
      name: "Standard",
      credits: 30,
      price: 12,
      pricePerCredit: 0.4,
      popular: true,
    },
    {
      key: "pro",
      name: "Pro",
      credits: 100,
      price: 30,
      pricePerCredit: 0.3,
    },
  ];
  res.json({ packs });
});

/**
 * POST /api/stripe/create-checkout
 * Creates a Stripe Checkout Session for purchasing a credit pack.
 */
router.post("/checkout", requireAuth, async (req: Request, res: Response) => {
  try {
    const { pack } = req.body;
    const { uid, email } = req.firebaseUser!;

    if (!pack || !CREDIT_PACKS[pack]) {
      return res.status(400).json({ error: "Invalid pack. Use: starter, standard, or pro" });
    }

    const priceEnvMap: Record<string, string> = {
      starter: process.env.STRIPE_PRICE_STARTER || "",
      standard: process.env.STRIPE_PRICE_STANDARD || "",
      pro: process.env.STRIPE_PRICE_PRO || "",
    };

    const priceId = priceEnvMap[pack];
    if (!priceId) {
      return res.status(500).json({ error: `Stripe price not configured for ${pack} pack` });
    }

    const stripe = await getStripe();
    const origin = req.headers.origin || `${req.protocol}://${req.get("host")}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        firebase_uid: uid,
        pack_key: pack,
        credits: String(CREDIT_PACKS[pack].credits),
      },
      success_url: `${origin}/dashboard?payment=success`,
      cancel_url: `${origin}/pricing?payment=cancelled`,
    });

    res.json({ url: session.url });
  } catch (error: any) {
    console.error("Stripe checkout error:", error);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

/**
 * POST /api/stripe/webhook
 * Handles Stripe webhook events (checkout.session.completed).
 * This endpoint should receive raw body (not JSON-parsed).
 */
router.post("/webhook", async (req: Request, res: Response) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not configured");
    return res.status(500).json({ error: "Webhook not configured" });
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    return res.status(400).json({ error: "Missing stripe-signature header" });
  }

  try {
    const stripe = await getStripe();
    // req.body should be the raw buffer when express.raw() is used on this route
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const metadata = session.metadata || {};
      const uid = metadata.firebase_uid;
      const packKey = metadata.pack_key;
      const credits = parseInt(metadata.credits || "0", 10);

      if (!uid || !credits) {
        console.error("Webhook missing metadata:", metadata);
        return res.status(400).json({ error: "Invalid session metadata" });
      }

      const packName = CREDIT_PACKS[packKey]?.name || `${credits} credits`;
      await creditsService.addCredits(uid, credits, session.id, `Purchased: ${packName}`);

      console.log(`Credits added: ${credits} for user ${uid} (${packName})`);
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error("Webhook error:", error.message);
    res.status(400).json({ error: `Webhook Error: ${error.message}` });
  }
});

export default router;
