import Stripe from "stripe";
import store from "../db-schema.server";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2025-06-15.basil" as any,
  httpClient: Stripe.createFetchHttpClient(),
});

const STRIPE_PRICE_ID_CACHE_KEY = "sensiskan_monthly_price_id";

let cachedPriceId: string | null = null;

export async function getOrCreateProductAndPrice(): Promise<string> {
  if (cachedPriceId) return cachedPriceId;

  // Check if the price ID is persisted in the DB
  if (store.db._meta && (store.db._meta as any)[STRIPE_PRICE_ID_CACHE_KEY]) {
    cachedPriceId = (store.db._meta as any)[STRIPE_PRICE_ID_CACHE_KEY] as string;
    return cachedPriceId;
  }

  // Query existing products
  const products = await stripe.products.list({
    limit: 100,
    active: true,
  });

  let product = products.data.find(
    (p) => p.name === "SensiScan Monthly Membership"
  );

  if (!product) {
    product = await stripe.products.create({
      name: "SensiScan Monthly Membership",
      description: "Unlimited barcode scans, personalized meal plans, reaction tracking, and sensitivity discovery.",
    });
  }

  // Find or create the monthly price
  const prices = await stripe.prices.list({
    product: product.id,
    active: true,
    limit: 5,
  });

  let price = prices.data.find(
    (p) =>
      p.type === "recurring" &&
      p.recurring?.interval === "month" &&
      p.unit_amount === 999
  );

  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: 999, // $9.99
      currency: "usd",
      recurring: { interval: "month" },
      lookup_key: "sensiskan_monthly",
    });
  }

  cachedPriceId = price.id;
  (store.db._meta as any)[STRIPE_PRICE_ID_CACHE_KEY] = price.id;
  store.save();

  return price.id;
}

export async function createCheckoutSession(
  userId: number,
  email: string,
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  const user = store.findUserById(userId);
  if (!user) throw new Error("User not found");

  const priceId = await getOrCreateProductAndPrice();

  let stripeCustomerId = user.stripe_customer_id;

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { userId: String(userId) },
    });
    stripeCustomerId = customer.id;
    store.updateUserSubscription(userId, {
      stripe_customer_id: stripeCustomerId,
    });
  }

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      metadata: { userId: String(userId) },
    },
    allow_promotion_codes: true,
    billing_address_collection: "auto",
  });

  if (!session.url) throw new Error("Failed to create checkout session");
  return session.url;
}

export async function getSubscription(userId: number): Promise<{
  status: "active" | "canceled" | "past_due" | "none";
  endDate: string | null;
  customerId: string | null;
}> {
  const user = store.findUserById(userId);
  if (!user) throw new Error("User not found");

  // If user has a Stripe customer ID, verify with Stripe
  if (user.stripe_customer_id) {
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: user.stripe_customer_id,
        status: "all",
        limit: 5,
      });

      const activeSub = subscriptions.data.find(
        (s) => s.status === "active" || s.status === "trialing"
      );

      if (activeSub) {
        const endDate = activeSub.current_period_end
          ? new Date(activeSub.current_period_end * 1000).toISOString()
          : null;

        // Sync with our DB
        store.updateUserSubscription(userId, {
          subscription_status: "active",
          subscription_end_date: endDate,
        });

        return {
          status: "active",
          endDate,
          customerId: user.stripe_customer_id,
        };
      }

      // Check for past_due
      const pastDueSub = subscriptions.data.find((s) => s.status === "past_due");
      if (pastDueSub) {
        store.updateUserSubscription(userId, {
          subscription_status: "past_due",
        });
        return {
          status: "past_due",
          endDate: user.subscription_end_date,
          customerId: user.stripe_customer_id,
        };
      }

      // Check for recently canceled (still active until period end)
      const canceledSub = subscriptions.data.find(
        (s) => s.status === "canceled" || s.status === "active"
      );
      if (canceledSub && canceledSub.cancel_at_period_end) {
        const endDate = canceledSub.current_period_end
          ? new Date(canceledSub.current_period_end * 1000).toISOString()
          : null;
        store.updateUserSubscription(userId, {
          subscription_status: "canceled",
          subscription_end_date: endDate,
        });
        return {
          status: "canceled",
          endDate,
          customerId: user.stripe_customer_id,
        };
      }
    } catch {
      // Stripe API call failed, fall back to local state
    }
  }

  return {
    status: user.subscription_status,
    endDate: user.subscription_end_date,
    customerId: user.stripe_customer_id,
  };
}

export async function cancelSubscription(
  userId: number
): Promise<{ success: boolean; endDate: string | null }> {
  const user = store.findUserById(userId);
  if (!user || !user.stripe_customer_id) {
    throw new Error("No active subscription found");
  }

  const subscriptions = await stripe.subscriptions.list({
    customer: user.stripe_customer_id,
    status: "active",
    limit: 1,
  });

  if (subscriptions.data.length === 0) {
    throw new Error("No active subscription found");
  }

  // Cancel at period end
  const sub = await stripe.subscriptions.update(subscriptions.data[0].id, {
    cancel_at_period_end: true,
  });

  const endDate = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  store.updateUserSubscription(userId, {
    subscription_status: "canceled",
    subscription_end_date: endDate,
  });

  return { success: true, endDate };
}

export async function createCustomerPortalSession(
  userId: number,
  returnUrl: string
): Promise<string> {
  const user = store.findUserById(userId);
  if (!user || !user.stripe_customer_id) {
    throw new Error("No Stripe customer found");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: returnUrl,
  });

  return session.url;
}
