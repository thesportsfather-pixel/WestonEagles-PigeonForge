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

async function supabaseGet(
  url,
  serviceRoleKey,
  path
) {
  const response = await fetch(
    `${url}/rest/v1/${path}`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization:
          `Bearer ${serviceRoleKey}`,
        Accept:
          "application/json",
      },
    }
  );

  const text =
    await response.text();

  let data = null;

  try {
    data =
      text
        ? JSON.parse(text)
        : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `Supabase ${response.status}: ${text}`
    );
  }

  return data;
}


export async function onRequestPost({
  request,
  env,
}) {
  try {

    // =====================================
    // REQUIRED ENVIRONMENT VARIABLES
    // =====================================

    const SUPABASE_URL =
      env.SUPABASE_URL;

    const SUPABASE_SERVICE_ROLE_KEY =
      env.SUPABASE_SERVICE_ROLE_KEY;

    const STRIPE_SECRET_KEY =
      env.STRIPE_SECRET_KEY;

    const SITE_URL =
      env.SITE_URL;

    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY ||
      !STRIPE_SECRET_KEY ||
      !SITE_URL
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
    // READ REQUEST BODY
    // =====================================

    const body =
      await request.json();

    const playerSlug =
      String(
        body.player_slug || ""
      ).trim();

    const anonymous =
      Boolean(
        body.anonymous
      );

    let donorName =
      String(
        body.donor_name || ""
      ).trim();

    if (
      anonymous ||
      !donorName
    ) {
      donorName =
        "Anonymous";
    }

    const donationAmount =
      Number(
        body.amount
      );


    // =====================================
    // VALIDATE PLAYER
    // =====================================

    if (!playerSlug) {
      return json(
        {
          success: false,
          error:
            "Missing player.",
        },
        400
      );
    }


    // =====================================
    // VALIDATE DONATION AMOUNT
    // =====================================

    if (
      !Number.isFinite(
        donationAmount
      ) ||
      donationAmount < 1
    ) {
      return json(
        {
          success: false,
          error:
            "Donation amount must be at least $1.",
        },
        400
      );
    }


    const amountCents =
      Math.round(
        donationAmount * 100
      );

    const amountDollars =
      amountCents / 100;


    // =====================================
    // LOAD WESTON EAGLES TEAM
    // =====================================

    const teams =
      await supabaseGet(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        `teams?team_key=eq.${encodeURIComponent(
          TEAM_KEY
        )}&select=id,team_key,team_name&limit=1`
      );

    if (
      !Array.isArray(teams) ||
      !teams[0]
    ) {
      return json(
        {
          success: false,
          error:
            "Weston Eagles team not found.",
        },
        404
      );
    }

    const team =
      teams[0];


    // =====================================
    // LOAD PLAYER
    // =====================================

    let players =
      await supabaseGet(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        `players?team_id=eq.${encodeURIComponent(
          team.id
        )}&slug=eq.${encodeURIComponent(
          playerSlug
        )}&select=id,slug,name,player_name,player_number,player_key&limit=1`
      );


    if (
      !Array.isArray(players) ||
      !players[0]
    ) {
      players =
        await supabaseGet(
          SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY,
          `players?team_id=eq.${encodeURIComponent(
            team.id
          )}&player_key=eq.${encodeURIComponent(
            playerSlug
          )}&select=id,slug,name,player_name,player_number,player_key&limit=1`
        );
    }


    if (
      !Array.isArray(players) ||
      !players[0]
    ) {
      return json(
        {
          success: false,
          error:
            "Player not found.",
        },
        404
      );
    }


    const player =
      players[0];

    const playerName =
      player.name ||
      player.player_name ||
      playerSlug;

    const playerNumber =
      player.player_number;


    // =====================================
    // STRIPE RETURN URLS
    // =====================================

    const cleanSiteUrl =
      SITE_URL.replace(
        /\/+$/,
        ""
      );

    const successUrl =
      `${cleanSiteUrl}/fundraiser.html?player=${encodeURIComponent(
        playerSlug
      )}&payment=success&session_id={CHECKOUT_SESSION_ID}`;

    const cancelUrl =
      `${cleanSiteUrl}/fundraiser.html?player=${encodeURIComponent(
        playerSlug
      )}&payment=cancelled`;


    // =====================================
    // CREATE STRIPE CHECKOUT SESSION
    // =====================================

    const form =
      new URLSearchParams();

    form.set(
      "mode",
      "payment"
    );

    form.set(
      "success_url",
      successUrl
    );

    form.set(
      "cancel_url",
      cancelUrl
    );

    form.set(
      "line_items[0][price_data][currency]",
      "usd"
    );

    form.set(
      "line_items[0][price_data][unit_amount]",
      String(
        amountCents
      )
    );

    form.set(
      "line_items[0][price_data][product_data][name]",
      `${playerName} - General Donation`
    );

    form.set(
      "line_items[0][price_data][product_data][description]",
      `Weston Eagles Road to Pigeon Forge fundraiser`
    );

    form.set(
      "line_items[0][quantity]",
      "1"
    );


    // =====================================
    // CHECKOUT SESSION METADATA
    // =====================================

    form.set(
      "metadata[donation_type]",
      "general"
    );

    form.set(
      "metadata[team_key]",
      TEAM_KEY
    );

    form.set(
      "metadata[player_id]",
      String(
        player.id
      )
    );

    form.set(
      "metadata[player_slug]",
      playerSlug
    );

    form.set(
      "metadata[player_name]",
      playerName
    );

    form.set(
      "metadata[player_number]",
      String(
        playerNumber ?? ""
      )
    );

    form.set(
      "metadata[donor_name]",
      donorName
    );

    form.set(
      "metadata[anonymous]",
      anonymous
        ? "true"
        : "false"
    );

    form.set(
      "metadata[amount_dollars]",
      String(
        amountDollars
      )
    );

    form.set(
      "metadata[amount_cents]",
      String(
        amountCents
      )
    );


    // =====================================
    // PAYMENT INTENT METADATA
    // =====================================

    form.set(
      "payment_intent_data[metadata][donation_type]",
      "general"
    );

    form.set(
      "payment_intent_data[metadata][team_key]",
      TEAM_KEY
    );

    form.set(
      "payment_intent_data[metadata][player_id]",
      String(
        player.id
      )
    );

    form.set(
      "payment_intent_data[metadata][player_slug]",
      playerSlug
    );

    form.set(
      "payment_intent_data[metadata][player_name]",
      playerName
    );

    form.set(
      "payment_intent_data[metadata][player_number]",
      String(
        playerNumber ?? ""
      )
    );

    form.set(
      "payment_intent_data[metadata][donor_name]",
      donorName
    );

    form.set(
      "payment_intent_data[metadata][anonymous]",
      anonymous
        ? "true"
        : "false"
    );

    form.set(
      "payment_intent_data[metadata][amount_dollars]",
      String(
        amountDollars
      )
    );

    form.set(
      "payment_intent_data[metadata][amount_cents]",
      String(
        amountCents
      )
    );


    // =====================================
    // SEND REQUEST TO STRIPE
    // =====================================

    const stripeResponse =
      await fetch(
        "https://api.stripe.com/v1/checkout/sessions",
        {
          method:
            "POST",

          headers: {
            Authorization:
              `Bearer ${STRIPE_SECRET_KEY}`,

            "Content-Type":
              "application/x-www-form-urlencoded",
          },

          body:
            form.toString(),
        }
      );


    const stripeData =
      await stripeResponse.json();


    if (
      !stripeResponse.ok
    ) {
      return json(
        {
          success: false,
          error:
            stripeData?.error?.message ||
            "Unable to create Stripe checkout session.",
          stripe:
            stripeData,
        },
        stripeResponse.status
      );
    }


    if (
      !stripeData.url
    ) {
      return json(
        {
          success: false,
          error:
            "Stripe checkout URL was not returned.",
        },
        500
      );
    }


    // =====================================
    // RETURN CHECKOUT URL
    // =====================================

    return json({
      success: true,

      url:
        stripeData.url,

      session_id:
        stripeData.id,

      player: {
        slug:
          playerSlug,

        name:
          playerName,

        number:
          playerNumber,
      },

      donationAmount:
        amountDollars,

      amountCents,
    });

  } catch (error) {

    console.error(
      "Weston Eagles create-general-donation error:",
      error
    );

    return json(
      {
        success: false,
        error:
          "Unable to create general donation checkout.",
        details:
          error.message,
      },
      500
    );
  }
}
