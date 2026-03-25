const OpenAI = require("openai");
const config = require("./aiModelConfig.js");

const SYSTEM_PROMPT =
  'You are an expert game designer. You must gather 8 parameters: gameName, genre, coreMechanic, artStyle, setting, playerCharacter, enemies, winCondition. CRITICAL: DO NOT ask for all of them at once. You must only ask for ONE missing parameter at a time in a brief, friendly, and conversational way. Wait for the user to answer before asking for the next one. Once you have all 8 clearly defined, output ONLY a raw JSON object containing these 8 keys, plus a 9th key: "isComplete": true. Do not include markdown formatting or extra text.';

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        Allow: "POST",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    if (!process.env.FEATHERLESS_API_KEY) {
      throw new Error("Missing FEATHERLESS_API_KEY environment variable");
    }

    console.log("🎯 AIMING AT SERVER:", config.baseURL);
    console.log("🤖 USING MODEL:", config.modelName);

    if (config.baseURL === undefined) {
      throw new Error(
        "config.baseURL is undefined! The aiModelConfig.js file is not exporting correctly."
      );
    }

    const client = new OpenAI({
      baseURL: config.baseURL,
      apiKey: process.env.FEATHERLESS_API_KEY,
    });

    const { messageHistory } = JSON.parse(event.body || "{}");

    if (!Array.isArray(messageHistory)) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "messageHistory must be an array" }),
      };
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messageHistory.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];

    const completion = await client.chat.completions.create({
      model: config.modelName,
      messages,
    });

    const assistantReply = completion.choices?.[0]?.message?.content?.trim() || "";

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
      body: assistantReply,
    };
  } catch (error) {
    console.error("Chat Function Error:", error);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
