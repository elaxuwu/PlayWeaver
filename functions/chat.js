import OpenAI from "openai";

const SYSTEM_PROMPT =
  'You are an expert game designer. You must gather 8 parameters: gameName, genre, coreMechanic, artStyle, setting, playerCharacter, enemies, winCondition. CRITICAL: DO NOT ask for all of them at once. You must only ask for ONE missing parameter at a time in a brief, friendly, and conversational way. Every time you ask the user a question, bold the specific question using markdown with double asterisks, for example **What kind of enemies will be in your game?**. Wait for the user to answer before asking for the next one. Once you have all 8 clearly defined, output ONLY a raw JSON object containing these 8 keys, plus a 9th key: "isComplete": true. Do not include markdown formatting or extra text in the final JSON response.';

export async function onRequestPost(context) {
  try {
    if (!context.env.FEATHERLESS_API_KEY) {
      throw new Error("Missing FEATHERLESS_API_KEY environment variable");
    }

    const client = new OpenAI({
      apiKey: context.env.FEATHERLESS_API_KEY,
      baseURL: "https://api.featherless.ai/v1",
    });

    const { messageHistory } = await context.request.json();

    if (!Array.isArray(messageHistory)) {
      return new Response(JSON.stringify({ error: "messageHistory must be an array" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    const completion = await client.chat.completions.create({
      model: "meta-llama/Meta-Llama-3.1-70B-Instruct",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messageHistory.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      ],
    });

    const assistantReply = completion.choices?.[0]?.message?.content?.trim() || "";

    return new Response(assistantReply, {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}
