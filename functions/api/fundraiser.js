const TEAM_KEY = "weston-eagles";
const GOAL_AMOUNT = 1830;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestGet(context) {
  try {
    const { env, request } = context;

    const SUPABASE_URL = env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY =
      env.SUPABASE_SERVICE_ROLE_KEY;

    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY
    ) {
      return json(
        {
          error:
            "Missing required environment variables.",
        },
        500
      );
    }

    const url = new URL(request.url);

    const playerSlug = (
      url.searchParams.get("player") || ""
    ).trim();

    if (!playerSlug) {
      return json(
        {
          error: "Missing player.",
        },
        400
      );
    }

    const headers = {
      apikey:
        SUPABASE_SERVICE_ROLE_KEY,

      Authorization:
        `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    };


    // =====================================
    // LOAD WESTON EAGLES TEAM
    // =====================================

    const teamResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/teams?team_key=eq.${encodeURIComponent(
        TEAM_KEY
      )}&select=id,team_key,team_name&limit=1`,
      {
        headers,
      }
    );

    const teams =
      await teamResponse.json();

    if (!teamResponse.ok) {
      return json(
        {
          error:
            "Unable to load team.",
          details: teams,
        },
        500
      );
    }

    if (
      !Array.isArray(teams) ||
      !teams[0]
    ) {
      return json(
        {
          error:
            "Team not found.",
        },
        404
      );
    }

    const team = teams[0];


    // =====================================
    // LOAD PLAYER
    // =====================================

    let playerResponse =
      await fetch(
        `${SUPABASE_URL}/rest/v1/players?team_id=eq.${encodeURIComponent(
          team.id
        )}&slug=eq.${encodeURIComponent(
          playerSlug
        )}&select=id,slug,name,player_name,player_number,player_key&limit=1`,
        {
          headers,
        }
      );

    let players =
      await playerResponse.json();

    if (!playerResponse.ok) {
      return json(
        {
          error:
            "Unable to load player.",
          details: players,
        },
        500
      );
    }


    // FALLBACK TO PLAYER_KEY
    if (
      !Array.isArray(players) ||
      !players[0]
    ) {
      playerResponse =
        await fetch(
          `${SUPABASE_URL}/rest/v1/players?team_id=eq.${encodeURIComponent(
            team.id
          )}&player_key=eq.${encodeURIComponent(
            playerSlug
          )}&select=id,slug,name,player_name,player_number,player_key&limit=1`,
          {
            headers,
          }
        );

      players =
        await playerResponse.json();
    }

    if (
      !Array.isArray(players) ||
      !players[0]
    ) {
      return json(
        {
          error:
            "Player not found.",
        },
        404
      );
    }

    const player =
      players[0];


    // =====================================
    // LOAD SOLD BASEBALLS
    // =====================================

    const ballsResponse =
      await fetch(
        `${SUPABASE_URL}/rest/v1/baseballs?team_id=eq.${encodeURIComponent(
          TEAM_KEY
        )}&player_id=eq.${encodeURIComponent(
          player.id
        )}&status=eq.sold&select=ball_number,donor_name,sold_at,stripe_session_id&order=ball_number.asc`,
        {
          headers,
        }
      );

    const soldBalls =
      await ballsResponse.json();

    if (!ballsResponse.ok) {
      return json(
        {
          error:
            "Unable to load baseballs.",
          details:
            soldBalls,
        },
        500
      );
    }


    // =====================================
    // CALCULATE BASEBALL MONEY RAISED
    // =====================================

    const baseballAmountRaised =
      (
        Array.isArray(soldBalls)
          ? soldBalls
          : []
      ).reduce(
        (sum, ball) =>
          sum +
          Number(
            ball.ball_number || 0
          ),
        0
      );


    // =====================================
    // LOAD PAID GENERAL DONATIONS
    // =====================================

    const ordersResponse =
      await fetch(
        `${SUPABASE_URL}/rest/v1/orders?team_id=eq.${encodeURIComponent(
          TEAM_KEY
        )}&player_id=eq.${encodeURIComponent(
          player.id
        )}&donation_type=eq.general&status=eq.paid&select=amount_cents,total_cents,amount`,
        {
          headers,
        }
      );

    const generalOrders =
      await ordersResponse.json();

    if (!ordersResponse.ok) {
      return json(
        {
          error:
            "Unable to load general donations.",
          details:
            generalOrders,
        },
        500
      );
    }


    // =====================================
    // CALCULATE GENERAL DONATIONS
    // =====================================

    const generalDonationAmount =
      (
        Array.isArray(
          generalOrders
        )
          ? generalOrders
          : []
      ).reduce(
        (sum, order) => {

          if (
            order.amount_cents != null
          ) {
            return (
              sum +
              Number(
                order.amount_cents || 0
              ) /
                100
            );
          }

          if (
            order.total_cents != null
          ) {
            return (
              sum +
              Number(
                order.total_cents || 0
              ) /
                100
            );
          }

          return (
            sum +
            Number(
              order.amount || 0
            )
          );
        },
        0
      );


    // =====================================
    // TOTAL PROGRESS
    // =====================================

    const amountRaised =
      baseballAmountRaised +
      generalDonationAmount;

    const progressPercent =
      Math.min(
        (amountRaised /
          GOAL_AMOUNT) *
          100,
        100
      );


    // =====================================
    // RETURN DATA
    // =====================================

    return json({
      success: true,

      team: {
        key:
          TEAM_KEY,

        name:
          team.team_name ||
          "Weston Eagles",
      },

      player: {
        id:
          player.id,

        slug:
          player.slug ||
          player.player_key ||
          playerSlug,

        name:
          player.name ||
          player.player_name,

        number:
          player.player_number,
      },

      soldBalls:
        Array.isArray(
          soldBalls
        )
          ? soldBalls
          : [],

      soldCount:
        Array.isArray(
          soldBalls
        )
          ? soldBalls.length
          : 0,

      baseballAmountRaised,

      generalDonationAmount,

      amountRaised,

      goalAmount:
        GOAL_AMOUNT,

      progressPercent:
        Math.round(
          progressPercent * 10
        ) / 10,
    });
  } catch (error) {
    return json(
      {
        error:
          "Unexpected server error.",

        details:
          error.message,
      },
      500
    );
  }
}
