const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// Reusable Gemini API caller
async function callGemini({ system, contents, json = false }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY_MISSING');
  }

  const preferredModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const modelsToTry = [preferredModel, 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];
  const uniqueModels = [...new Set(modelsToTry)];

  let lastError = null;

  for (const model of uniqueModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const body = {
        contents,
        generationConfig: {
          temperature: json ? 0.1 : 0.6,
          ...(json ? { responseMimeType: 'application/json' } : {})
        }
      };

      if (system) {
        body.systemInstruction = { parts: [{ text: system }] };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        const data = await res.json();
        const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
        return text;
      } else {
        const errText = await res.text();
        lastError = new Error(`Gemini API error for model ${model} status ${res.status}: ${errText}`);
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('GEMINI_CALL_FAILED');
}

// 1. AI Assistant Chat Route
app.post('/api/ai/assistant', async (req, res) => {
  try {
    const { prompt, history = [], user, lang = 'hi-IN' } = req.body;
    
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const system = `You are "Shram Sahayak", an empathetic, clear, and highly accessible voice & text AI assistant for Indian migrant workers using the Shram Sanchar portal.
Reply in the user's primary language (${lang} / language of their message).
Keep answers very short, simple, and respectful (3-5 lines max). Avoid complex technical jargon.
User context: ${user ? `Name: ${user.name}, UAN: ${user.uan}` : 'Guest / Not logged in'}.

Knowledge base:
- Login: UAN (12 digits) + OTP verification (demo OTP: 123456).
- UAN: Universal Account Number issued under eShram portal for unorganised workers.
- Location updates: Workers update mobility voluntarily using voice/text.
- Privacy & Location: GPS/location is strictly OFF by default and never tracked continuously. Only accessed ONCE when worker permits during a mobility update.
- eShram: Official Government portal for unorganised migrant workers to access social security benefits.
- Government Schemes: Financial Support, Health (PM-JAY), Housing (PMAY), Employment, Pension (PM-SYM), Skill Development.
- Helplines: eShram (14434), Emergency (112), Ambulance (108), Women (181), Childline (1098).

If the user asks about pensions, schemes, complaints, or logins, guide them directly in simple words.`;

    const contents = [
      ...history.map(m => ({
        role: m.role === 'user' || m.role === 'me' ? 'user' : 'model',
        parts: [{ text: m.text || m.content || '' }]
      })),
      { role: 'user', parts: [{ text: prompt }] }
    ];

    const reply = await callGemini({ system, contents });
    return res.json({ success: true, reply, provider: 'gemini' });
  } catch (err) {
    console.warn('Gemini Assistant fallback triggered:', err.message);
    
    // Fallback response generator
    const promptLower = (req.body.prompt || '').toLowerCase();
    let reply = "Shram Sanchar helps you update your work location easily with voice. Call eShram helpline 14434 for official support.";
    
    if (promptLower.includes('login') || promptLower.includes('log in') || promptLower.includes('लॉगिन')) {
      reply = "To log in: Enter your name, 12-digit UAN number, and mobile number. You will receive an OTP (for demo, enter 123456).";
    } else if (promptLower.includes('uan') || promptLower.includes('यूएएन')) {
      reply = "UAN is your 12-digit eShram Universal Account Number. It connects your migrant worker profile across all Indian states.";
    } else if (promptLower.includes('pension') || promptLower.includes('पेंशन')) {
      reply = "For pensions, you can check PM Shram Yogi Maandhan (PM-SYM). It provides ₹3,000 monthly pension after age 60. Check the Government Schemes tab for details.";
    } else if (promptLower.includes('location') || promptLower.includes('track') || promptLower.includes('लोकेशन')) {
      reply = "We do NOT track you continuously. Your location is read ONCE only when you give permission for a mobility update.";
    }

    return res.json({ 
      success: true, 
      reply, 
      provider: 'fallback_rules',
      notice: err.message === 'GEMINI_API_KEY_MISSING' ? 'Gemini API key is not configured on server. Using smart fallback rules.' : 'Gemini AI temporarily unavailable.'
    });
  }
});

// 2. AI Mobility Intent Extraction
app.post('/api/ai/extract-intent', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text prompt required' });
    }

    const system = `You convert a migrant worker's spoken or typed statement (in any Indian language or English) into structured mobility update JSON.
Return JSON ONLY with these exact keys:
{
  "intent": "MOBILITY_UPDATE",
  "destination": "City Name, State Code (e.g. Surat, Gujarat)",
  "occupation": "Job/Work Type (e.g. Construction Worker, Factory Worker, Agriculture, Delivery / Driving, Textile, Hospitality, Domestic Work, Mining, Security)",
  "status": "One of: Traveling, Arrived, Returning home, Seeking work, Other",
  "confidence": 0.95
}
Extract accurately. If destination or occupation is missing, provide best estimation or empty string if totally unknown.`;

    const contents = [{ role: 'user', parts: [{ text }] }];
    const jsonStr = await callGemini({ system, contents, json: true });
    
    let parsed;
    try {
      parsed = JSON.parse(jsonStr.replace(/```json|```/g, '').trim());
    } catch {
      throw new Error('FAILED_TO_PARSE_GEMINI_JSON');
    }

    return res.json({ success: true, data: parsed, provider: 'gemini' });
  } catch (err) {
    console.warn('Gemini intent extraction fallback triggered:', err.message);

    // Smart local regex fallback
    const text = (req.body.text || '');
    let destination = '';
    let occupation = 'Unspecified Work';
    let status = 'Traveling';

    if (/surat|सूरत|સુરત/i.test(text)) destination = 'Surat, Gujarat';
    else if (/pune|पुणे/i.test(text)) destination = 'Pune, Maharashtra';
    else if (/mumbai|मुंबई/i.test(text)) destination = 'Mumbai, Maharashtra';
    else if (/delhi|दिल्ली/i.test(text)) destination = 'Delhi, DL';
    else if (/bengaluru|bangalore|बेंगलुरु/i.test(text)) destination = 'Bengaluru, Karnataka';
    else if (/gurugram|gurgaon|गुड़गांव/i.test(text)) destination = 'Gurugram, Haryana';
    else if (/noida|नोएडा/i.test(text)) destination = 'Noida, Uttar Pradesh';

    if (/construct|mason|mistri|building|निर्माण|मिस्त्री|राजमिस्त्री/i.test(text)) occupation = 'Construction Worker';
    else if (/factory|company|plant|कारखाना|फैक्ट्री/i.test(text)) occupation = 'Factory Worker';
    else if (/farm|kheti|crop|खेती|फसल/i.test(text)) occupation = 'Agriculture Worker';
    else if (/driver|delivery|truck|ड्राइवर|डिलीवरी/i.test(text)) occupation = 'Delivery / Driver';

    if (/return|going home|wapas|वापस|घर/i.test(text)) status = 'Returning home';
    else if (/reached|arrived|pahunch|पहुँच|आ गया/i.test(text)) status = 'Arrived';
    else if (/seeking|need work|काम चाहिए/i.test(text)) status = 'Seeking work';

    return res.json({
      success: true,
      data: {
        intent: 'MOBILITY_UPDATE',
        destination: destination || 'Unspecified Location',
        occupation: occupation,
        status: status,
        confidence: destination ? 0.85 : 0.65
      },
      provider: 'fallback_rules'
    });
  }
});

// 3. Scheme Category Recommender
app.post('/api/ai/recommend-scheme', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text query required' });

    const system = `Identify which government scheme category a worker is looking for based on their query (e.g. "Mujhe pension chahiye" -> Pension, "Bimari ke liye madad" -> Health).
Return JSON ONLY:
{
  "category": "One of: Pension, Health, Housing, Financial Support, Employment, Skill Development",
  "explanation": "Short sentence explaining why",
  "suggested_schemes": ["Scheme 1", "Scheme 2"]
}`;

    const contents = [{ role: 'user', parts: [{ text }] }];
    const jsonStr = await callGemini({ system, contents, json: true });
    const parsed = JSON.parse(jsonStr.replace(/```json|```/g, '').trim());

    return res.json({ success: true, data: parsed, provider: 'gemini' });
  } catch (err) {
    const text = (req.body.text || '').toLowerCase();
    let cat = 'Financial Support';
    
    if (/pension|60|buddha|old age|पेंशन/i.test(text)) cat = 'Pension';
    else if (/health|hospital|ill|doctor|ayushman|बीमारी|अस्पताल|इलाज/i.test(text)) cat = 'Health';
    else if (/house|home|makan|shelter|आवास|मकान|घर/i.test(text)) cat = 'Housing';
    else if (/job|skill|traing|kaushal|काम|नौकरी|ट्रेनिंग/i.test(text)) cat = 'Skill Development';
    else if (/work|labor|employment|रोजगार|मजदूरी/i.test(text)) cat = 'Employment';

    return res.json({
      success: true,
      data: {
        category: cat,
        explanation: 'Identified relevant scheme category based on query keywords.',
        suggested_schemes: []
      },
      provider: 'fallback_rules'
    });
  }
});

// 4. Mock eShram Integration Service
const eshramService = {
  getIntegrationStatus() {
    return {
      environment: 'Prototype / Sandbox',
      eshramApi: 'Mock Integration',
      productionStatus: 'Requires authorized government API access & OAuth2 credentials',
      apiVersion: 'v1.4-sandbox',
      lastSyncTime: new Date().toISOString()
    };
  },

  updateWorkerMobility(updateData) {
    return {
      success: true,
      transactionId: 'ESHRAM-TX-' + Math.floor(100000 + Math.random() * 900000),
      uan: updateData.uan,
      status: 'RECORD_UPDATED_IN_SANDBOX',
      timestamp: new Date().toISOString(),
      updatedFields: {
        currentLocation: updateData.destination,
        occupation: updateData.occupation || updateData.jobType,
        mobilityStatus: updateData.status || updateData.intent,
        confidenceScore: updateData.confidenceScore
      }
    };
  }
};

app.get('/api/eshram/status', (req, res) => {
  res.json(eshramService.getIntegrationStatus());
});

app.post('/api/eshram/mobility-update', (req, res) => {
  const result = eshramService.updateWorkerMobility(req.body);
  res.json(result);
});

// Fallback all SPA routes to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Shram Sanchar server listening on http://localhost:${PORT}`);
  console.log(`Gemini API Key configured: ${process.env.GEMINI_API_KEY ? 'YES (Server-side)' : 'NO (Using fallback rules)'}`);
});
