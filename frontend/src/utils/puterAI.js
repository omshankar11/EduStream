// frontend/src/utils/puterAI.js
// Puter.js powered AI helpers — no API key, no backend needed.

// gpt-4o-mini is reliably available on Puter.js free tier.
// gemini-2.5-flash-preview was causing 100% failures (model not found).
const MODEL = "gpt-4o-mini";

/**
 * Waits for puter global to be available (loaded via <script> tag).
 */
function waitForPuter(timeout = 15000) {
  return new Promise((resolve, reject) => {
    if (window.puter) return resolve(window.puter);
    const start = Date.now();
    const interval = setInterval(() => {
      if (window.puter) {
        clearInterval(interval);
        resolve(window.puter);
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error(
          "Puter.js failed to load. Make sure you are connected to the internet."
        ));
      }
    }, 100);
  });
}

/**
 * Normalises any response shape that puter.ai.chat() may return.
 * Handles: plain string, { message: { content } }, { content }, OpenAI choices[] format.
 */
function extractText(response) {
  if (typeof response === "string") return response;
  if (typeof response?.message?.content === "string") return response.message.content;
  if (typeof response?.content === "string") return response.content;
  if (Array.isArray(response?.choices) && response.choices.length > 0) {
    const first = response.choices[0];
    return first?.message?.content ?? first?.text ?? "";
  }
  // Last resort: stringify and inspect
  try { return JSON.stringify(response); } catch { return ""; }
}

/**
 * Generate an AI summary from a video transcript.
 * @param {string} transcript - Raw transcript text
 * @returns {Promise<string>} Markdown-formatted summary
 */
export async function summarizeWithPuter(transcript) {
  const puter = await waitForPuter();

  const cleanText =
    typeof transcript === "string"
      ? transcript.replace(/\[.*?\]/g, "").trim()
      : Array.isArray(transcript)
      ? transcript.map((i) => i.text).join(" ")
      : "";

  if (!cleanText) throw new Error("Transcript is empty.");

  const truncated = cleanText.substring(0, 30000);

  const prompt = `You are an expert teacher. Your goal is to teach the content of this video transcript to a student.

Instructions:
1. **Filter Noise**: Ignore filler words, off-topic banter, and self-promotion. Focus only on the core educational content.
2. **Direct Teaching**: Do NOT use phrases like "The speaker says" or "In this video". Teach the concepts directly as if you are the instructor.
3. **Structure**:
   - **Key Topics**: List the main topics discussed.
   - **Core Concepts**: Explain the important ideas in developer-friendly terms.
   - **Questions Addressed**: List any specific questions or problems solved.
4. **Format**: Use clear markdown headings (###) and bullet points (*). Keep it concise and easy to read.

Transcript:
${truncated}`;

  let response;
  try {
    response = await puter.ai.chat(prompt, { model: MODEL });
  } catch (callErr) {
    // Puter may throw if user isn't signed in or model is unavailable
    throw new Error(
      callErr?.message?.includes("sign")
        ? "Please sign in to Puter.com to use AI features (opens in a new tab)."
        : `AI service error: ${callErr?.message || "Unknown error"}`
    );
  }

  const text = extractText(response);
  if (!text) throw new Error("AI returned an empty summary. Please try again.");
  return text;
}

/**
 * Generate a multiple-choice quiz from a summary or transcript.
 * @param {string} sourceText - Summary (preferred) or transcript
 * @param {"easy"|"medium"|"hard"} difficulty
 * @returns {Promise<Array>} Array of quiz question objects
 */
export async function quizWithPuter(sourceText, difficulty = "medium") {
  const puter = await waitForPuter();

  if (!sourceText?.trim()) throw new Error("Source text is required.");

  const truncated = sourceText.substring(0, 30000);

  const prompt = `You are a quiz generator. Generate 5 multiple-choice questions based on the content provided below.

Difficulty Level: ${difficulty}

Output Requirement:
Return ONLY a valid JSON array. Each object must have:
- "question": string
- "options": array of exactly 4 strings
- "correctAnswer": integer (0-3, the index of the correct option)

Do NOT include any text outside the JSON array.

Content:
${truncated}`;

  let response;
  try {
    response = await puter.ai.chat(prompt, { model: MODEL });
  } catch (callErr) {
    throw new Error(
      callErr?.message?.includes("sign")
        ? "Please sign in to Puter.com to use AI features."
        : `AI service error: ${callErr?.message || "Unknown error"}`
    );
  }

  const raw = extractText(response);

  // Strip possible markdown code fences
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();

  let quiz;
  try {
    quiz = JSON.parse(cleaned);
  } catch {
    throw new Error("AI returned an invalid quiz format. Please retry.");
  }

  if (!Array.isArray(quiz) || quiz.length === 0)
    throw new Error("AI returned an empty quiz. Please retry.");

  return quiz;
}
