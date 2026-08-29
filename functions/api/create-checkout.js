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

    const requestedBaseballs =
      Array.isArray(
        body.baseballs
      )
        ? body.baseballs
        : [];

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
    // VALIDATE BASEBALLS
    // =====================================

    const baseballs =
      [
        ...new Set(
          requestedBaseballs
            .map(Number)
            .filter(
              (ball) =>
                Number.isInteger(ball) &&
                ball >= 1 &&
                ball <= 60
            )
        ),
      ].sort(
        (a, b) =>
          a - b
      );

    if (!baseballs.length) {
      return json(
        {
          success: false,
          error:
            "Please select at least one baseball.",
        },
        400
      );
    }


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


    // Fallback for older player records
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
    // CHECK IF ANY SELECTED BASEBALLS
    // ARE ALREADY SOLD
    // =====================================

    const ballFilter =
      `(${baseballs.join(
        ","
      )})`;

    const soldBalls =
      await supabaseGet(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        `baseballs?team_id=eq.${encodeURIComponent(
          TEAM_KEY
        )}&player_id=eq.${encodeURIComponent(
          player.id
        )}&ball_number=in.${ballFilter}&status=eq.sold&select=ball_number`
      );

    if (
      Array.isArray(soldBalls) &&
      soldBalls.length
    ) {
      const unavailableBalls =
        soldBalls
          .map(
            (ball) =>
              Number(
                ball.ball_number
              )
          )
          .sort(
            (a, b) =>
              a - b
          );

      return json(
        {
          success: false,
          error:
            "One or more selected baseballs have already been sold.",
          unavailableBalls,
        },
        409
      );
    }


    // =====================================
    // CALCULATE DONATION TOTAL
    // =====================================

    const totalDollars =
      baseballs.reduce(
        (sum, ball) =>
          sum + ball,
        0
      );

    const totalCents =
      totalDollars * 100;


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
      String(totalCents)
    );

    form.set(
      "line_items[0][price_data][product_data][name]",
      `${playerName} - Road to Pigeon Forge`
    );

    form.set(
      "line_items[0][price_data][product_data][description]",
      `Weston Eagles baseball fundraiser — Baseball${baseballs.length > 1 ? "s" : ""} #${baseballs.join(
        ", #"
      )}`
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
      "baseballs"
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
      "metadata[baseballs]",
      baseballs.join(",")
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
      String(totalDollars)
    );

    form.set(
      "metadata[amount_cents]",
      String(totalCents)
    );


    // =====================================
    // PAYMENT INTENT METADATA
    // =====================================

    form.set(
      "payment_intent_data[metadata][donation_type]",
      "baseballs"
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
      "payment_intent_data[metadata][baseballs]",
      baseballs.join(",")
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

      baseballs,

      totalDollars,

      totalCents,
    });

  } catch (error) {

    console.error(
      "Weston Eagles create-checkout error:",
      error
    );

    return json(
      {
        success: false,
        error:
          "Unable to create checkout session.",
        details:
          error.message,
      },
      500
    );
  }
}
