require("dotenv").config();
const { validatePlay } = require("./validatePlay");
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
  const startTotal = Date.now(); // timing 

  try {
    const { transcript, gameState } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: "transcript is required" });
    }

  // added a shorter prompt that asks for bare bones JSON 
    const systemPrompt = `You are a baseball scorekeeping assistant. Parse voice transcripts into structured plays.

CURRENT STATE: ${gameState ? `Inning ${gameState.half} ${gameState.inning}, ${gameState.outs} outs, Score: Away ${gameState.score?.away || 0}-Home ${gameState.score?.home || 0}, Runners: 1B=${gameState.runners?.first || "empty"} 2B=${gameState.runners?.second || "empty"} 3B=${gameState.runners?.third || "empty"}` : "Start of game"}

RULES: Account for force plays. All runners must be included in movement array.

Return ONLY valid JSON (no markdown, no backticks):
{
  "inning": number,
  "half": "top"|"bottom",
  "batter": string,
  "pitcher": string,
  "action": "single"|"double"|"triple"|"home run"|"strikeout"|"walk"|"fly out"|"ground out"|"hit by pitch"|"error"|"fielder's choice"|"stolen base"|"wild pitch"|"passed ball"|"balk"|"sacrifice fly",
  "description": string,
  "runners": [{"from": string, "to": string, "runner": string}],
  "rbi": number,
  "outs_recorded": number,
  "fielders_involved": string[],
  "hit_location": string,
  "hit_type": "ground ball"|"line drive"|"fly ball"|"pop up"|"bunt",
  "hit_hardness": "soft"|"medium"|"hard",
  "field_zone": number,
  "pitch_type": string,
  "pitch_location": "inside"|"outside"|"high"|"low"|"middle",
  "count": string,
  "confidence": "high"|"medium"|"low"
}`;
    const startFetch = Date.now(); // timing 

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
        // added parameters to reduce token usage + response time
        num_predict: 300,
        temperature: 0.1,
        top_p: 0.9,
        top_k: 40,
      }),
    });

    const fetchTime = Date.now() - startFetch; //timing

    if (!response.ok) {
      const text = await response.text();
      console.error("AI API error:", response.status, text);
      return res.status(response.status).json({ error: "AI processing failed" });
    }

    const startDataParse = Date.now(); // timing
    const data = await response.json();
    const dataParse = Date.now() - startDataParse; // timing
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error("No content in response:", JSON.stringify(data));
      return res.status(500).json({ error: "No content returned from AI" });
    }

    const startClean = Date.now(); // timing
const cleaned = content
  .replace(/```json\n?/g, "")
  .replace(/```\n?/g, "")
  .replace(/^[\s\S]*?({[\s\S]*})[\s\S]*$/, "$1")
  .trim(); 
    const cleanTime = Date.now() - startClean; // timing
// rejects a bad json 
let rawPlay;
try {
  rawPlay = JSON.parse(cleaned);
} catch (parseErr) {
  console.error("JSON parse error:", parseErr, "Raw content:", content);
  return res.status(500).json({ error: "Could not parse AI response as JSON" });
}
// rejects a bad play or patches a play with missing fields
const result = validatePlay(rawPlay);
if (!result.ok) {
  console.error("Play failed validation:", result.reason, "Raw:", rawPlay);
  return res.status(422).json({ error: "AI response didn't include a valid play. Try rephrasing." });
}

if (result.patched) {
  console.warn("Play had to be patched, forcing low confidence:", result.play);
}

return res.json({ play: result.play, patched: result.patched });
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

