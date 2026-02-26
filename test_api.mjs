// Test Gemini API connectivity
const API_URL = "https://yunwu.ai/v1beta/models/gemini-3-flash-preview:streamGenerateContent?key=&alt=sse";
const API_KEY = "sk-JrZjjnwnrtkLV8i3v8K2TSV9CLTpmHqx0twPjDIjyGYfBuYO";

const body = {
  systemInstruction: { parts: [{ text: "You are a cat. Your name is Neko." }] },
  contents: [{ role: "user", parts: [{ text: "Hello there, say meow" }] }],
  generationConfig: { temperature: 1, topP: 1 }
};

console.log("Testing Gemini API at yunwu.ai...");
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 20000);

try {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: controller.signal
  });
  clearTimeout(timeout);
  console.log(`✅ Status: ${res.status} ${res.statusText}`);
  const text = await res.text();
  console.log("Response (first 500 chars):");
  console.log(text.substring(0, 500));
} catch (err) {
  clearTimeout(timeout);
  console.log(`❌ Error: ${err.message}`);
}
