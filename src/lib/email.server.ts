import store from "../db-schema.server";

const FROM_ADDRESS = "sensiscan-c4c93ff7@ctomail.io";
const APP_URL = "https://1556684c19626204e0fe9ccd77d278af.ctonew.app";

interface EmailPayload {
  to: string;
  subject: string;
  body: string;
}

function logEmail(
  userId: number,
  emailType: "welcome" | "reset" | "subscription",
  payload: EmailPayload,
): void {
  store.insertEmailLog(userId, emailType, payload.to, payload.subject);
  console.log(
    `[EMAIL] type=${emailType} to=${payload.to} subject="${payload.subject}"`,
  );
}

export function sendWelcomeEmail(user: {
  id: number;
  email: string;
  name: string;
}): EmailPayload {
  const subject = "Welcome to SensiScan! 🎉";
  const body = `Hi ${user.name},

Welcome to SensiScan! We're excited to help you shop, eat, and apply products with confidence.

Here's how to get started:

1. Add your sensitivities — Head to your dashboard and add any ingredients you need to avoid (food and skincare).

2. Scan products — Use the barcode scanner in stores to instantly see if a product contains any of your trigger ingredients.

3. Plan meals — Generate personalized meal plans that automatically exclude your flagged ingredients.

4. Track reactions — Log any reactions you have, and SensiScan will help you discover hidden sensitivities over time.

You're on our Free plan with 10 scans to try things out. When you're ready, upgrade to Pro for just $9.99/month to get unlimited scans.

Start scanning: ${APP_URL}/dashboard

Stay safe and scan on,
The SensiScan Team`;

  const payload: EmailPayload = { to: user.email, subject, body };
  logEmail(user.id, "welcome", payload);
  return payload;
}

export function sendPasswordResetEmail(
  user: { id: number; email: string; name: string },
  resetToken: string,
): EmailPayload {
  const subject = "Reset your SensiScan password";
  const resetLink = `${APP_URL}/reset-password?token=${resetToken}`;
  const body = `Hi ${user.name},

We received a request to reset the password for your SensiScan account.

Click the link below to set a new password. This link expires in 1 hour.

${resetLink}

If you didn't request a password reset, you can safely ignore this email — your password will not be changed.

Stay safe,
The SensiScan Team`;

  const payload: EmailPayload = { to: user.email, subject, body };
  logEmail(user.id, "reset", payload);
  return payload;
}

export function sendSubscriptionConfirmation(user: {
  id: number;
  email: string;
  name: string;
}): EmailPayload {
  const subject = "Your SensiScan Pro membership is active! 🔒";
  const body = `Hi ${user.name},

Thanks for upgrading to SensiScan Pro! Your membership is now active.

Here's what you get with Pro:

• Unlimited barcode scans — scan as many products as you want
• Personalized meal plans — fresh plans every week, auto-filtered for your sensitivities
• Reaction tracking and sensitivity discovery — log reactions and uncover hidden triggers
• Priority support — we're here when you need us

Start using your Pro benefits: ${APP_URL}/dashboard

If you have any questions, just reply to this email.

Happy scanning,
The SensiScan Team`;

  const payload: EmailPayload = { to: user.email, subject, body };
  logEmail(user.id, "subscription", payload);
  return payload;
}
