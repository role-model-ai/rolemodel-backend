import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors({
  origin: "https://dynamic-shortbread-0d370c.netlify.app",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json());

// Requires Node 18+ for global fetch
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function checkSafety(text) {
  if (!text || !text.trim()) return { flagged: false };

  const moderation = await openai.moderations.create({
    model: "omni-moderation-latest",
    input: text,
  });

  const result = moderation.results[0];
  return { flagged: result.flagged, categories: result.categories };
}

async function fetchWikipediaSummary(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    title
  )}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error("Wikipedia request failed");
  }

  const data = await res.json();
  return {
    summary: data.extract || "",
    url: data.content_urls?.desktop?.page ||
      `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
  };
}

async function getRoleModelMatches({ stage, future, values, strengths }) {
const prompt = `
You are a "role model matcher" for a website that helps people of all ages find positive, healthy public figures to learn from.

User description:
- Life stage: "${stage || "not given"}"
- Future they want: "${future}"
- Values: "${values || "not given"}"
- Strengths: "${strengths || "not given"}"

Your job:
- Suggest up to 3 REAL ADULT people who have Wikipedia pages.
- You may choose people from ANY country, background, or field, as long as they are broadly positive examples (builders, scientists, artists, athletes, educators, social leaders, entrepreneurs, etc.).
- Avoid people mainly known for crime, hate, extremism, self-harm, or explicit sexual content.
- Avoid extremist political figures.
- Look beyond the most obvious 2–3 names if possible, as long as the fit is good.
- Match their story to the user's themes: field, impact, lifestyle, and values.

Important:
- TRY HARD to return 3 different people.
- Only return 2 if you really cannot think of a safe third person.
- Only return 1 if it would be unsafe or dishonest to return more.

Variety rules:
- Try hard NOT to pick the same world-famous names every time (for example, avoid always suggesting the same two or three celebrities or politicians).
- At most one very famous "obvious" person; the others should be less overused but still well-known enough to have solid Wikipedia pages.
- Aim for some diversity in field, background, and perspective, as long as they are still a good fit.

Return ONLY valid JSON in this format, no extra text:

{
  "matches": [
    {
      "name": "Full Name",
      "wiki_title": "Exact_Wikipedia_Page_Title_Using_Underscores",
      "short_reason": "1-2 sentences explaining why this person fits the user's goals and values."
    }
  ]
}
`.trim();


  const response = await openai.responses.create({
    model: "gpt-4o-mini", // or "gpt-4.1-mini" if you prefer 
    input: prompt,
    temperature: 1.0,
  });

  const raw = response.output_text;
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("JSON parse error from model:", err, raw);
    throw new Error("AI output was not valid JSON");
  }

  const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
  return matches.slice(0, 3);
}

app.post("/api/recommend", async (req, res) => {
  const { stage, future, values, strengths } = req.body || {};
  const combinedText = [stage, future, values, strengths].filter(Boolean).join("\n");

  if (!future || future.trim().length < 20) {
    return res.status(400).json({
      ok: false,
      error: "Please describe the kind of future you want in a bit more detail.",
    });
  }

  try {
    // 1) Safety check on the user's text
    const safety = await checkSafety(combinedText);
    if (safety.flagged) {
      return res.status(400).json({
        ok: false,
        error:
          "This app can only be used for positive, school-safe and work-safe goals (careers, learning, creativity, service, etc.). " +
          "Try describing the kind of person you want to become or the impact you want to have—without harmful or explicit themes.",
      });
    }

    // 2) Ask AI to suggest role models
    const rawMatches = await getRoleModelMatches({ stage, future, values, strengths });

    if (!rawMatches.length) {
      return res.status(200).json({
        ok: true,
        matches: [],
      });
    }

    // 3) For each match, pull Wikipedia summary
    const enriched = [];
    for (const m of rawMatches) {
      if (!m.wiki_title || !m.name) continue;

      try {
        const wiki = await fetchWikipediaSummary(m.wiki_title);
        enriched.push({
  name: m.name,
  wiki_title: m.wiki_title,
  reason: m.short_reason || "",
  wiki_summary: wiki.summary,
  wiki_url: wiki.url,
});

      } catch (err) {
        console.warn("Wikipedia lookup failed for", m.wiki_title, err);
      }
    }

    return res.status(200).json({
      ok: true,
      matches: enriched,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: "Server error while looking for role models. Please try again.",
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Role model backend listening on http://localhost:${PORT}`);
});


