const TEAM_KEY = "weston-eagles";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }

  return bytes;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }

  return result === 0;
}

async function verifyStripeSignature(
  payload,
  signature,
  secret
) {
  if (!signature || !secret) {
    return false;
  }

  const parts =
    signature.split(",");

  const timestampPart =
    parts.find((part) =>
      part.startsWith("t=")
    );

  const signatureParts =
    parts
      .filter((part) =>
        part.startsWith("v1=")
      )
      .map((part) =>
        part.slice(3)
      );

  if (
    !timestampPart ||
    !signatureParts.length
  ) {
    return false;
  }

  const timestamp =
    timestampPart.slice(2);

  const signedPayload =
    `${timestamp}.${payload}`;

  const encoder =
    new TextEncoder();

  const key =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256",
      },
      false,
      ["sign"]
    );

  const signatureBuffer =
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        signedPayload
      )
    );

  const expectedBytes =
    new Uint8Array(
      signatureBuffer
    );

  for (
    const stripeSignature
    of signatureParts
  ) {
    try {
      const receivedBytes =
        hexToBytes(
          stripeSignature
        );

      if (
        timingSafeEqual(
          expectedBytes,
          receivedBytes
        )
      ) {
        return true;
      }
    } catch {
      // ignore malformed signature
    }
  }

  return false;
}

async function supabaseRequest(
  env,
  path,
  options = {}
) {
  const response =
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/${path}`,
      {
        ...options,

        headers: {
          apikey:
            env.SUPABASE_SERVICE_ROLE_KEY,

          Authorization:
            `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,

          "Content-Type":
            "application/json",

          Prefer:
            options.headers?.Prefer ||
            "return=minimal",

          ...(options.headers || {}),
        },
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase ${response.status}: ${text}`
    );
  }

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function onRequestPost({
  request,
  env,
}) {
  try {

    // =====================================
    // REQUIRED VARIABLES
    // =====================================

    if (
      !env.SUPABASE_URL ||
      !env.SUPABASE_SERVICE_ROLE_KEY ||
      !env.STRIPE_WEBHOOK_SECRET
    ) {
      return json(
        {
          success: false,
          error:
            "Missing required environment variables.",
        },
        500
      );
    }


    // =====================================
    // VERIFY STRIPE SIGNATURE
    // =====================================

    const payload =
      await request.text();

    const stripeSignature =
      request.headers.get(
        "stripe-signature"
      );

    const validSignature =
      await verifyStripeSignature(
        payload,
        stripeSignature,
        env.STRIPE_WEBHOOK_SECRET
      );

    if (!validSignature) {
      return json(
        {
          success: false,
          error:
            "Invalid Stripe signature.",
        },
        400
      );
    }


    // =====================================
    // PARSE STRIPE EVENT
    // =====================================

    const event =
      JSON.parse(payload);

    if (
      event.type !==
      "checkout.session.completed"
    ) {
      return json({
        success: true,
        ignored: true,
        event_type:
          event.type,
      });
    }


    const session =
      event.data?.object;

    if (!session) {
      return json(
        {
          success: false,
          error:
            "Stripe session missing.",
        },
        400
      );
    }


    // =====================================
    // ONLY PROCESS PAID SESSIONS
    // =====================================

    if (
      session.payment_status !==
      "paid"
    ) {
      return json({
        success: true,
        ignored: true,
        reason:
          "Session is not paid.",
      });
    }


    const metadata =
      session.metadata || {};

    const donationType =
      String(
        metadata.donation_type ||
        ""
      ).trim();

    const teamKey =
      String(
        metadata.team_key ||
        ""
      ).trim();


    // =====================================
    // PROTECT AGAINST OTHER TEAMS
    // =====================================

    if (
      teamKey !==
      TEAM_KEY
    ) {
      return json({
        success: true,
        ignored: true,
        reason:
          "Webhook event belongs to another team.",
      });
    }


    // =====================================
    // READ PLAYER + DONOR DATA
    // =====================================

    const playerId =
      String(
        metadata.player_id ||
        ""
      ).trim();

    const playerSlug =
      String(
        metadata.player_slug ||
        ""
      ).trim();

    const playerName =
      String(
        metadata.player_name ||
        ""
      ).trim();

    const playerNumber =
      metadata.player_number
        ? Number(
            metadata.player_number
          )
        : null;

    const anonymous =
      String(
        metadata.anonymous ||
        "false"
      ) === "true";

    let donorName =
      String(
        metadata.donor_name ||
        ""
      ).trim();

    if (
      anonymous ||
      !donorName
    ) {
      donorName =
        "Anonymous";
    }


    // =====================================
    // PAYMENT DETAILS
    // =====================================

    const amountCents =
      Number(
        session.amount_total ||
        metadata.amount_cents ||
        0
      );

    const amountDollars =
      amountCents / 100;

    const paymentIntent =
      typeof session.payment_intent ===
      "string"
        ? session.payment_intent
        : null;

    const paidAt =
      new Date().toISOString();


    // =====================================
    // BASEBALL DONATION
    // =====================================

    if (
      donationType ===
      "baseballs"
    ) {

      if (!playerId) {
        return json(
          {
            success: false,
            error:
              "Missing player ID in Stripe metadata.",
          },
          400
        );
      }


      const baseballs =
        String(
          metadata.baseballs ||
          ""
        )
          .split(",")
          .map(Number)
          .filter(
            (ball) =>
              Number.isInteger(ball) &&
              ball >= 1 &&
              ball <= 60
          );


      if (!baseballs.length) {
        return json(
          {
            success: false,
            error:
              "No valid baseballs found in Stripe metadata.",
          },
          400
        );
      }


      // =====================================
      // MARK EACH BALL SOLD
      // =====================================

      for (
        const ballNumber
        of baseballs
      ) {
        await supabaseRequest(
          env,
          `baseballs?team_id=eq.${encodeURIComponent(
            TEAM_KEY
          )}&player_id=eq.${encodeURIComponent(
            playerId
          )}&ball_number=eq.${encodeURIComponent(
            ballNumber
          )}&status=neq.sold`,
          {
            method:
              "PATCH",

            body:
              JSON.stringify({
                status:
                  "sold",

                donor_name:
                  donorName,

                donor_email:
                  null,

                sold_at:
                  paidAt,

                stripe_session_id:
                  session.id,

                reserved_until:
                  null,

                reservation_id:
                  null,
              }),
          }
        );
      }


      // =====================================
      // RECORD ORDER
      // =====================================

      await supabaseRequest(
        env,
        "orders",
        {
          method:
            "POST",

          body:
            JSON.stringify({
              player_id:
                playerId,

              stripe_session_id:
                session.id,

              stripe_payment_intent_id:
                paymentIntent,

              stripe_payment_intent:
                paymentIntent,

              total_cents:
                amountCents,

              status:
                "paid",

              customer_email:
                null,

              paid_at:
                paidAt,

              team_id:
                TEAM_KEY,

              player_slug:
                playerSlug,

              player_name:
                playerName,

              player_number:
                playerNumber,

              donation_type:
                "baseballs",

              baseballs,

              donor_name:
                donorName,

              donor_email:
                null,

              anonymous,

              amount:
                amountDollars,

              amount_cents:
                amountCents,

              payment_status:
                session.payment_status,
            }),
        }
      );


      return json({
        success: true,

        processed:
          "baseballs",

        player:
          playerName,

        baseballs,

        amount:
          amountDollars,
      });
    }


    // =====================================
    // GENERAL DONATION
    // =====================================

    if (
      donationType ===
      "general"
    ) {

      if (!playerId) {
        return json(
          {
            success: false,
            error:
              "Missing player ID in Stripe metadata.",
          },
          400
        );
      }


      await supabaseRequest(
        env,
        "orders",
        {
          method:
            "POST",

          body:
            JSON.stringify({
              player_id:
                playerId,

              stripe_session_id:
                session.id,

              stripe_payment_intent_id:
                paymentIntent,

              stripe_payment_intent:
                paymentIntent,

              total_cents:
                amountCents,

              status:
                "paid",

              customer_email:
                null,

              paid_at:
                paidAt,

              team_id:
                TEAM_KEY,

              player_slug:
                playerSlug,

              player_name:
                playerName,

              player_number:
                playerNumber,

              donation_type:
                "general",

              baseballs:
                null,

              donor_name:
                donorName,

              donor_email:
                null,

              anonymous,

              amount:
                amountDollars,

              amount_cents:
                amountCents,

              payment_status:
                session.payment_status,
            }),
        }
      );


      return json({
        success: true,

        processed:
          "general",

        player:
          playerName,

        amount:
          amountDollars,
      });
    }


    // =====================================
    // UNKNOWN DONATION TYPE
    // =====================================

    return json({
      success: true,

      ignored: true,

      reason:
        "Unknown donation type.",

      donation_type:
        donationType,
    });

  } catch (error) {

    console.error(
      "Weston Eagles Stripe webhook error:",
      error
    );

    return json(
      {
        success: false,

        error:
          "Webhook processing failed.",

        details:
          error.message,
      },
      500
    );
  }
}
