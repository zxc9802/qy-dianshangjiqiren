const res = await fetch('https://yunwu.ai/v1beta/models/gemini-3-flash-preview:streamGenerateContent?key=&alt=sse', {
    method: 'POST',
    headers: {
        'Authorization': 'Bearer sk-DGhb98NyeNXIcGM1r2PWdE4AflBH7hpOMMCayfnJHsF7MTuY',
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        systemInstruction: { parts: [{ text: 'You are a cat. Your name is Neko.' }] },
        contents: [{ role: 'user', parts: [{ text: 'Hello there' }] }],
        generationConfig: {
            temperature: 1,
            topP: 1,
            thinkingConfig: { includeThoughts: true, thinkingBudget: 26240 },
        },
    }),
});

console.log('Status:', res.status, res.statusText);
const text = await res.text();
console.log('Response (first 2000 chars):\n', text.slice(0, 2000));
