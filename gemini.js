// The Gemini side of think(), used when CUE_MODEL_PROVIDER=gemini (#55).
// One generateContent call with Google Search grounding and Cue's display
// tools as function declarations. Search runs on Google's side inside that
// call, and display tools are fire-and-forget, so no tool results go back and
// one request is the whole tick. An error here fails the tick (server.js
// answers 500); there is no Claude fallback, by Tyler's call (2026-11-13).
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const THINKING = process.env.GEMINI_THINKING || "low";
// A guard against a hung request, not a latency budget.
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 30000);
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Gemini's `parameters` is an OpenAPI subset: no additionalProperties, and a
// tool without arguments leaves parameters out.
function declaration({ name, description, input_schema }) {
  const strip = (s) => {
    if (!s || typeof s !== "object") return s;
    const { additionalProperties, ...rest } = s;
    if (rest.properties) rest.properties = Object.fromEntries(Object.entries(rest.properties).map(([k, v]) => [k, strip(v)]));
    if (rest.items) rest.items = strip(rest.items);
    return rest;
  };
  const d = { name, description };
  if (Object.keys(input_schema.properties || {}).length) d.parameters = strip(input_schema);
  return d;
}

// Prices are not known here yet, so cost reads as zero (unknown), as in
// agent.js for an unlisted model. Fill in from ai.google.dev/pricing.
const PRICES = {};

export async function thinkGemini({ system, user, displayTools }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const names = new Set(displayTools.map((t) => t.name));
  const body = {
    systemInstruction: { parts: [{ text: system.replace(/web_search \(and web_fetch on the best page\)|web_search/g, "Google Search") }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    tools: [{ googleSearch: {} }, { functionDeclarations: displayTools.map(declaration) }],
    // Lets Google Search and function calls share one turn (Gemini 3
    // "tool combination").
    toolConfig: { includeServerSideToolInvocations: true },
    generationConfig: { thinkingConfig: { thinkingLevel: THINKING } },
  };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${json.error?.status || ""} ${(json.error?.message || "").slice(0, 160)}`.trim());

  const cand = json.candidates?.[0];
  if (!cand) throw new Error(`no candidate (${json.promptFeedback?.blockReason || "empty response"})`);
  const parts = cand.content?.parts || [];
  const actions = parts
    .filter((p) => p.functionCall && names.has(p.functionCall.name))
    .map((p) => ({ tool: p.functionCall.name, input: p.functionCall.args || {} }));

  const u = json.usageMetadata || {};
  const p = PRICES[MODEL] || { in: 0, out: 0 };
  const cached = u.cachedContentTokenCount || 0;
  const input = (u.promptTokenCount || 0) + (u.toolUsePromptTokenCount || 0) - cached;
  const output = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
  const searches = cand.groundingMetadata?.webSearchQueries?.length || 0;
  const usage = { model: json.modelVersion || MODEL, provider: "gemini", requests: 1, input, cacheRead: cached, cacheWrite: 0,
    output, searches, fetches: 0, usd: (input * p.in + cached * p.in * 0.1 + output * p.out) / 1e6 };
  const note = cand.finishReason && !["STOP", "MAX_TOKENS"].includes(cand.finishReason) && !actions.length ? `gemini: ${cand.finishReason}` : undefined;
  return { actions, usage, ...(note && { note }) };
}
