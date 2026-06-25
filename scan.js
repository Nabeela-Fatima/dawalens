// api/scan.js
// This runs on Vercel's server, NEVER in the browser.
// Your Gemini API key stays hidden here.

export default async function handler(req, res) {
  // Allow requests from any origin (so the app works for anyone, anywhere)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  try {
    const { imageBase64, mimeType } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server not configured — missing API key' });
    }

    const prompt = `You are looking at a photo of a medicine (a pill, tablet, capsule, blister strip, or bottle), possibly with no visible label or packaging.

Describe what you can see and make a careful, honest best guess at identification. Respond ONLY with valid JSON, no markdown fences, no preamble, in exactly this shape:

{
  "likelyName": "string - your best guess at a specific medicine name if any text/markings are visible, otherwise a general description like 'White round tablet'",
  "genericGuess": "string - likely active ingredient/category if inferable, otherwise 'Unable to determine from appearance alone'",
  "commonUse": "string - one short sentence on what this type of medicine is typically used for, or 'Cannot be determined from appearance alone' if truly unidentifiable",
  "physicalDescription": "string - what you actually observed: shape, colour, coating, any visible imprint or partial text",
  "confidence": integer from 0-100 representing how confident you genuinely are in the identification (be honest and conservative - if there's no visible text/marking, confidence should be low, e.g. 20-40),
  "isReadable": boolean - true if the image clearly shows a medicine, false if the image is blurry, unrelated, or not a medicine at all
}

Be honest about uncertainty. Visual identification of medicines without packaging is inherently unreliable - never claim high confidence unless there are clear, legible markings.`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } }
            ]
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 500
          }
        })
      }
    );

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error('Gemini API error:', geminiData);
      return res.status(502).json({ error: 'AI service error', detail: geminiData?.error?.message || 'Unknown error' });
    }

    const textOutput = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textOutput) {
      return res.status(502).json({ error: 'No response from AI service' });
    }

    // Clean up potential markdown fences
    const cleaned = textOutput.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '');

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('JSON parse failed:', cleaned);
      return res.status(502).json({ error: 'Could not parse AI response' });
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
