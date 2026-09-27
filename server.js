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

  const preferredModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const modelsToTry = [preferredModel, 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];
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


// 4. Contractor registry — in-memory store (replace with DB in production)
const contractors = new Map();   // id -> contractorObj
const jobPostings  = new Map();  // id -> jobObj

// Contractor registration
app.post('/api/contractor/register', async (req, res) => {
  try {
    const { name, company, mobile, email, password, city, state, gst, description } = req.body;
    if (!name || !company || !mobile || !password || !city || !state)
      return res.status(400).json({ error: 'name, company, mobile, password, city and state are required.' });

    // Prevent duplicate mobile
    for (const c of contractors.values()) {
      if (c.mobile === mobile) return res.status(409).json({ error: 'A contractor with this mobile already exists.' });
    }

    const id = 'CTR-' + Date.now();
    const contractor = {
      id, name, company, mobile, email: email || '', password,
      city, state, gst: gst || '', description: description || '',
      verified: false, trustScore: null, trustReason: '', trustFlags: [],
      createdAt: new Date().toISOString(), jobsPosted: 0
    };
    contractors.set(id, contractor);

    // Kick off async Gemini trust-score analysis (don't block registration)
    computeTrustScore(id).catch(() => {});

    const { password: _pw, ...safe } = contractor;
    return res.json({ success: true, contractor: safe, message: 'Registration successful. An admin will review your profile.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Contractor login
app.post('/api/contractor/login', (req, res) => {
  const { mobile, password } = req.body;
  if (!mobile || !password) return res.status(400).json({ error: 'mobile and password required.' });
  for (const c of contractors.values()) {
    if (c.mobile === mobile && c.password === password) {
      const { password: _pw, ...safe } = c;
      return res.json({ success: true, contractor: safe });
    }
  }
  return res.status(401).json({ error: 'Invalid credentials.' });
});

// List all contractors (admin)
app.get('/api/contractor/list', (_req, res) => {
  const list = [...contractors.values()].map(({ password: _pw, ...safe }) => safe);
  res.json({ success: true, contractors: list });
});

// Admin verify/reject contractor
app.post('/api/contractor/verify', (req, res) => {
  const { id, verified } = req.body;
  const c = contractors.get(id);
  if (!c) return res.status(404).json({ error: 'Contractor not found.' });
  c.verified = !!verified;
  res.json({ success: true, contractor: { ...c, password: undefined } });
});

// Re-run Gemini trust score
app.post('/api/contractor/trust-score', async (req, res) => {
  const { id } = req.body;
  const c = contractors.get(id);
  if (!c) return res.status(404).json({ error: 'Contractor not found.' });
  try {
    await computeTrustScore(id);
    const { password: _pw, ...safe } = contractors.get(id);
    return res.json({ success: true, contractor: safe });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

async function computeTrustScore(contractorId) {
  const c = contractors.get(contractorId);
  if (!c) return;
  try {
    const system = `You assess contractor trustworthiness for migrant workers on an Indian labour portal.
Given the contractor profile, return JSON ONLY:
{
  "trustScore": <integer 0-100>,
  "trustLevel": "High" | "Medium" | "Low" | "Unverified",
  "reason": "<one-sentence rationale>",
  "flags": ["<optional list of concerns or missing info>"]
}
Score based on: profile completeness (name, company, GST, city, description), contact details, description quality.
Complete profile with GST: 70-100. Missing GST or vague description: 40-70. Suspicious or very sparse: 0-40.`;

    const profileText = `Name: ${c.name}, Company: ${c.company}, Mobile: ${c.mobile}, Email: ${c.email || 'not provided'}, City: ${c.city}, State: ${c.state}, GST: ${c.gst || 'not provided'}, Description: "${c.description || 'not provided'}", Registered: ${c.createdAt}`;

    const contents = [{ role: 'user', parts: [{ text: profileText }] }];
    const jsonStr = await callGemini({ system, contents, json: true });
    const parsed = JSON.parse(jsonStr.replace(/```json|```/g, '').trim());

    c.trustScore  = parsed.trustScore  ?? null;
    c.trustLevel  = parsed.trustLevel  || 'Unverified';
    c.trustReason = parsed.reason      || '';
    c.trustFlags  = parsed.flags       || [];
  } catch {
    // Fallback rule-based trust score
    let score = 10;
    if (c.name && c.company)                        score += 20;
    if (c.email)                                    score += 10;
    if (c.gst)                                      score += 25;
    if (c.description && c.description.length > 30) score += 20;
    if (c.city && c.state)                          score += 15;
    c.trustScore  = Math.min(score, 100);
    c.trustLevel  = score >= 70 ? 'High' : score >= 45 ? 'Medium' : 'Low';
    c.trustReason = 'Score computed from profile completeness (fallback rules).';
    c.trustFlags  = [];
  }
  contractors.set(contractorId, c);
}

// Post a job alert
app.post('/api/jobs/post', (req, res) => {
  const { contractorId, title, jobType, city, state, wage, vacancies, description, startDate } = req.body;
  const c = contractors.get(contractorId);
  if (!c) return res.status(404).json({ error: 'Contractor not found.' });
  if (!c.verified) return res.status(403).json({ error: 'Your account must be verified by admin before posting jobs.' });
  if (!title || !jobType || !city || !state)
    return res.status(400).json({ error: 'title, jobType, city and state are required.' });

  const id = 'JOB-' + Date.now();
  const job = {
    id, contractorId, contractorName: c.name, company: c.company,
    trustScore: c.trustScore, trustLevel: c.trustLevel,
    title, jobType, city, state: state.trim().toUpperCase(),
    wage: wage || '', vacancies: vacancies || 1, description: description || '',
    startDate: startDate || '', active: true,
    createdAt: new Date().toISOString()
  };
  jobPostings.set(id, job);
  c.jobsPosted = (c.jobsPosted || 0) + 1;
  res.json({ success: true, job });
});

// Personalised job alerts for a worker (matched by destination state/city)
app.get('/api/jobs/alerts', (req, res) => {
  const { state, city, jobType } = req.query;
  const jobs = [...jobPostings.values()].filter(j => j.active);
  const scored = jobs.map(j => {
    let relevance = 0;
    if (state   && j.state.toLowerCase() === state.toLowerCase())           relevance += 3;
    if (city    && j.city.toLowerCase().includes(city.toLowerCase()))       relevance += 2;
    if (jobType && j.jobType.toLowerCase().includes(jobType.toLowerCase())) relevance += 1;
    return { ...j, relevanceScore: relevance };
  }).sort((a, b) => b.relevanceScore - a.relevanceScore || new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, jobs: scored });
});

// Jobs posted by a specific contractor
app.get('/api/jobs/by-contractor/:id', (req, res) => {
  const jobs = [...jobPostings.values()].filter(j => j.contractorId === req.params.id);
  res.json({ success: true, jobs });
});

// Seed demo contractors + jobs
(function seedContractors() {
  const dc = [
    { id:'CTR-DEMO1', name:'Rajesh Builders', company:'Rajesh Construction Pvt Ltd', mobile:'9876543210', email:'rajesh@rbuilders.in', password:'demo123', city:'Surat', state:'GJ', gst:'27AAPFU0939F1ZV', description:'Leading construction firm in Gujarat with 15+ years experience specialising in residential and industrial projects.', verified:true, trustScore:82, trustLevel:'High', trustReason:'Complete profile with GST, company email, and detailed description.', trustFlags:[], createdAt:'2024-01-15T08:00:00.000Z', jobsPosted:2 },
    { id:'CTR-DEMO2', name:'Suresh Textiles', company:'Suresh Yarn Mills', mobile:'9123456789', email:'', password:'demo123', city:'Surat', state:'GJ', gst:'', description:'Textile manufacturer hiring workers.', verified:false, trustScore:38, trustLevel:'Low', trustReason:'Missing GST and email reduces score significantly.', trustFlags:['No GST number','No email provided','Short description'], createdAt:'2024-01-20T10:00:00.000Z', jobsPosted:0 },
    { id:'CTR-DEMO3', name:'Priya Farm Collective', company:'Priya Agro Collective', mobile:'9001234567', email:'priya@agro.co.in', password:'demo123', city:'Nashik', state:'MH', gst:'27BBBPP0939F1ZA', description:'Seasonal farm work for grape and onion harvest in Nashik region. Fair wages, accommodation provided.', verified:true, trustScore:74, trustLevel:'High', trustReason:'Complete profile with GST and good description.', trustFlags:[], createdAt:'2024-01-22T09:00:00.000Z', jobsPosted:1 },
  ];
  dc.forEach(c => contractors.set(c.id, c));

  const dj = [
    { id:'JOB-DEMO1', contractorId:'CTR-DEMO1', contractorName:'Rajesh Builders', company:'Rajesh Construction Pvt Ltd', trustScore:82, trustLevel:'High', title:'Mason & Shuttering Carpenter', jobType:'Construction', city:'Surat', state:'GJ', wage:'₹650/day', vacancies:12, description:'Experienced masons and shuttering carpenters for a 7-floor residential project at Vesu, Surat. Accommodation provided.', startDate:'2024-02-01', active:true, createdAt:'2024-01-16T10:00:00.000Z' },
    { id:'JOB-DEMO2', contractorId:'CTR-DEMO1', contractorName:'Rajesh Builders', company:'Rajesh Construction Pvt Ltd', trustScore:82, trustLevel:'High', title:'General Labour — Foundation Work', jobType:'Construction', city:'Ahmedabad', state:'GJ', wage:'₹500/day', vacancies:20, description:'General labour for foundation digging and concrete work at Ahmedabad site. No prior experience required.', startDate:'2024-02-10', active:true, createdAt:'2024-01-17T10:00:00.000Z' },
    { id:'JOB-DEMO3', contractorId:'CTR-DEMO3', contractorName:'Priya Farm Collective', company:'Priya Agro Collective', trustScore:74, trustLevel:'High', title:'Grape Harvest Workers', jobType:'Agriculture', city:'Nashik', state:'MH', wage:'₹450/day + meals', vacancies:30, description:'Seasonal grape harvest in Nashik. Work period Feb–March. Accommodation and daily meals included. Families welcome.', startDate:'2024-02-01', active:true, createdAt:'2024-01-23T08:00:00.000Z' },
  ];
  dj.forEach(j => jobPostings.set(j.id, j));
})();


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

// 5. Additional REST APIs for schemes, help, authentication, and mobility
const SCHEMES_DATA = [
  { id: '1', category: 'Pension', name: 'Pradhan Mantri Shram Yogi Maandhan (PM-SYM)', description: 'Voluntary & contributory pension scheme providing ₹3,000/month after age 60.', target_audience: 'Unorganised workers aged 18-40', benefit: '₹3,000 monthly pension', official_url: 'https://maandhan.in' },
  { id: '2', category: 'Health', name: 'Ayushman Bharat PM-JAY', description: 'Free healthcare coverage up to ₹5 Lakh per family per year for secondary & tertiary hospitalisation.', target_audience: 'Low-income migrant families', benefit: 'Health coverage up to ₹5 Lakh/year', official_url: 'https://pmjay.gov.in' },
  { id: '3', category: 'Housing', name: 'Affordable Rental Housing Complexes (ARHCs / PMAY)', description: 'Dignified rental housing near work sites for urban migrants and industrial workers.', target_audience: 'Urban migrants and industrial workers', benefit: 'Subsidised rental accommodation near work', official_url: 'https://pmaymis.gov.in' },
  { id: '4', category: 'Financial Support', name: 'eShram Accidental Death & Disability Cover', description: 'Insurance cover of ₹2 Lakh for accidental death/permanent disability and ₹1 Lakh for partial disability.', target_audience: 'All active eShram card holders', benefit: '₹2 Lakh accidental insurance', official_url: 'https://eshram.gov.in' },
  { id: '5', category: 'Employment', name: 'National Career Service (NCS) Portal Integration', description: 'Nationwide job portal connecting unorganised workers directly with verified employers.', target_audience: 'Migrant workers seeking employment', benefit: 'Direct employment matching', official_url: 'https://www.ncs.gov.in' },
  { id: '6', category: 'Skill Development', name: 'Pradhan Mantri Kaushal Vikas Yojana (PMKVY)', description: 'Free skill training, certification, and RPL (Recognition of Prior Learning) for unorganised workers.', target_audience: 'Construction and informal sector workers', benefit: 'Free skill training & certification', official_url: 'https://www.pmkvyofficial.org' }
];

const HELP_DATA = [
  { id: '1', title: 'Login Help', content: 'Use your 12-digit UAN number and registered mobile number. For demo purposes, the OTP code is 123456.' },
  { id: '2', title: 'Mobility Update Help', content: 'You can update your work destination anytime by voice or typing. Location permission is voluntary and read ONCE per update.' },
  { id: '3', title: 'Privacy & GPS', content: 'Shram Sanchar NEVER tracks you in the background. No continuous GPS trails are stored.' },
  { id: '4', title: 'eShram Portal Info', content: 'eShram is the official Government portal for unorganised workers. Call official helpline 14434 for card issues.' }
];

app.get('/api/schemes', (req, res) => {
  res.json({ success: true, schemes: SCHEMES_DATA });
});

app.get('/api/help', (req, res) => {
  res.json({ success: true, help: HELP_DATA });
});

app.post('/api/auth/login', (req, res) => {
  const { name, uan, mobile } = req.body;
  if (!name || !uan || !mobile) {
    return res.status(400).json({ error: 'Name, UAN, and Mobile number are required.' });
  }
  return res.json({ success: true, message: 'OTP sent successfully. Demo OTP is 123456.', otp_sent: true });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const { uan, otp } = req.body;
  if (otp === '123456') {
    return res.json({ success: true, token: 'demo-token-' + Date.now(), uan });
  }
  return res.status(401).json({ error: 'Invalid OTP. For demo use 123456.' });
});

app.post('/api/consent', (req, res) => {
  const { uan, location_consent, ai_consent } = req.body;
  res.json({
    success: true,
    consent_status: {
      uan,
      location_consent: !!location_consent,
      ai_consent: !!ai_consent,
      timestamp: new Date().toISOString()
    }
  });
});

// Fallback all SPA routes to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Shram Sanchar server listening on http://localhost:${PORT}`);
  console.log(`Gemini API Key configured: ${process.env.GEMINI_API_KEY ? 'YES (Server-side)' : 'NO (Using fallback rules)'}`);
});
