require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const {
  OPENAI_API_KEY,
  AI_BASE_URL = "https://api.openai.com/v1",
  AI_MODEL = "gpt-4o-mini",
  PORT = 3001,
} = process.env;

if (!OPENAI_API_KEY) {
  console.error("ERROR: OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.");
  process.exit(1);
}

app.post("/api/parse-play", async (req, res) => {
  try {
    const { transcript, gameState } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: "transcript is required" });
    }

    const systemPrompt = `You are a baseball scorekeeping assistant for the Atlantic League. Parse the user's voice transcript into a structured baseball play.

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

If unclear, still parse it and set confidence to "low". Return ONLY the JSON object, nothing else.`;

    const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: transcript },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("AI API error:", response.status, text);
      return res.status(response.status).json({ error: "AI processing failed" });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error("No content in response:", JSON.stringify(data));
      return res.status(500).json({ error: "No content returned from AI" });
    }

    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    try {
      const play = JSON.parse(cleaned);
      return res.json({ play });
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr, "Raw content:", content);
      return res.status(500).json({ error: "Could not parse AI response as JSON" });
    }
  } catch (e) {
    console.error("parse-play error:", e);
    return res.status(500).json({ error: e.message || "Unknown error" });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", model: AI_MODEL, baseUrl: AI_BASE_URL });
});

app.listen(PORT, () => {
  console.log(`\n🎙️  Voice Scorekeeper API running on http://localhost:${PORT}`);
  console.log(`   Model: ${AI_MODEL}`);
  console.log(`   API:   ${AI_BASE_URL}\n`);
});
