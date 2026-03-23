import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcript, gameState } = await req.json();
    const AI_GATEWAY_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!AI_GATEWAY_KEY) throw new Error("AI gateway key is not configured");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_GATEWAY_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5-mini",
        messages: [
          {
            role: "system",
            content: `You are a baseball scorekeeping assistant for the Atlantic League. Parse the user's voice transcript into a structured baseball play.

CURRENT GAME STATE:
${gameState ? `- Inning: ${gameState.half} of ${gameState.inning}
- Outs: ${gameState.outs}
- Runner on 1st: ${gameState.runners?.first || "none"}
- Runner on 2nd: ${gameState.runners?.second || "none"}
- Runner on 3rd: ${gameState.runners?.third || "none"}
- Score: Away ${gameState.score?.away || 0} - Home ${gameState.score?.home || 0}` : "No game state provided (start of game)"}

IMPORTANT: Use the current game state to correctly determine runner movements. If a runner is already on a base and the batter reaches that base, the existing runner must advance. Account for force plays and tag-ups on fly balls.

Return ONLY valid JSON with no markdown, no code blocks, no extra text. Use this exact structure:

{
  "inning": number or null,
  "half": "top" or "bottom" or null,
  "batter": string or null,
  "pitcher": string or null,
  "action": string (e.g. "single", "strikeout", "fly out", "home run", "walk", "double", "triple", "ground out", "sacrifice fly", "hit by pitch", "error", "fielder's choice", "stolen base", "wild pitch", "passed ball", "balk"),
  "description": string (a clean, concise description of the play),
  "runners": [{ "from": string, "to": string, "runner": string or null }],
  "rbi": number,
  "outs_recorded": number,
  "fielders_involved": string[],
  "hit_location": string or null (where the ball was hit, e.g. "left field", "right-center gap", "shortstop hole", "third base line"),
  "hit_type": string or null (how the ball was hit, e.g. "ground ball", "line drive", "fly ball", "pop up", "bunt"),
  "hit_hardness": string or null (contact quality, e.g. "hard", "soft", "medium"),
  "field_zone": number or null (spray chart zone 1-9: 1=left line, 2=left, 3=left-center, 4=center, 5=right-center, 6=right, 7=right line, 8=infield left, 9=infield right),
  "pitch_type": string or null (e.g. "fastball", "curveball", "slider", "changeup"),
  "pitch_location": string or null (e.g. "inside", "outside", "high", "low", "down the middle"),
  "count": string or null (ball-strike count, e.g. "2-1", "3-2"),
  "confidence": "high" or "medium" or "low"
}

Include ALL runner movements in the "runners" array — both existing base runners AND the batter. For example, if a runner is on first and the batter singles, include both the runner advancing from first and the batter going to first.

If unclear, still parse it and set confidence to "low". Return ONLY the JSON object, nothing else.`
          },
          {
            role: "user",
            content: transcript
          }
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI processing failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error("No content in response:", JSON.stringify(data));
      return new Response(JSON.stringify({ error: "No content returned from AI" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Strip markdown code blocks if present
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    try {
      const play = JSON.parse(cleaned);
      return new Response(JSON.stringify({ play }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr, "Raw content:", content);
      return new Response(JSON.stringify({ error: "Could not parse AI response as JSON" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

  } catch (e) {
    console.error("parse-play error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
