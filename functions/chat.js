import OpenAI from "openai";

const BOARD_FIELDS = [
  "gameName",
  "genre",
  "coreMechanic",
  "artStyle",
  "setting",
  "playerCharacter",
  "enemies",
  "winCondition",
];

const EMPTY_BOARD_STATE = Object.freeze(
  BOARD_FIELDS.reduce((boardState, field) => {
    boardState[field] = "None";
    return boardState;
  }, {})
);

const FIELD_QUESTIONS = {
  gameName: "What should the game be called?",
  genre: "What genre fits this game best?",
  coreMechanic: "What is the main gameplay mechanic?",
  artStyle: "What art style should the game have?",
  setting: "Where does the game take place?",
  playerCharacter: "Who does the player control?",
  enemies: "What kinds of enemies or obstacles should appear?",
  winCondition: "How does the player win?",
};

const CONFIRMATION_MESSAGE =
  "All details are set! Are you ready to generate the game, or do you want to change anything?";
const CONFIRMATION_PROMPT = `**${CONFIRMATION_MESSAGE}**`;

const SYSTEM_PROMPT = `You are PlayWeaver, a highly enthusiastic, natural, and friendly game design partner.
Your job is to gather exactly 8 parameters for a game concept: gameName, genre, coreMechanic, artStyle, setting, playerCharacter, enemies, winCondition.

Always output a strict JSON object and nothing else.
The JSON must always use this exact shape:
{"message":"Your friendly response here","boardState":{"gameName":"None","genre":"None","coreMechanic":"None","artStyle":"None","setting":"None","playerCharacter":"None","enemies":"None","winCondition":"None"},"isComplete":false}
Every boardState key must be present on every turn.

CRITICAL RULES:
1. EXTRACT FIRST: Read the user's initial message carefully. If they already provided the genre, character, setting, etc., fill them into the JSON immediately. DO NOT ask for them.
2. RETAIN MEMORY: Never overwrite a previously filled parameter with "None". Always output the current known values in your JSON.
3. BOLD THE QUESTION: Wrap the actual question you are asking in double asterisks so it bolds. Example: **What setting do you want?**
4. CONFIRMATION STEP: When all 8 parameters are filled, DO NOT set "isComplete": true yet. Instead, ask the user: **All details are set! Are you ready to generate the game, or do you want to change anything?**.
5. COMPLETION: ONLY set "isComplete": true if all 8 are filled AND the user explicitly confirms they are ready. If they want to change something, keep "isComplete": false and update the JSON.

Additional behavior rules:
- Ask for only ONE missing parameter at a time.
- If a field is still missing or unclear, set it to "None".
- Only bold the main question inside the "message" field. Do not bold suggestions, examples, encouragement, or any other text.
- Be upbeat, natural, and collaborative. You may include one or two brief creative suggestions to help the user brainstorm.
- Never wrap the JSON in markdown or code fences. Never add commentary outside the JSON object.`;

function normalizeBoardValue(value) {
  if (typeof value !== "string") {
    return "None";
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : "None";
}

function stripPrematureCompletionText(message) {
  if (typeof message !== "string") {
    return "";
  }

  return message
    .replace(
      /\*\*All details are set! Are you ready to generate the game, or do you want to change anything\?\*\*/gi,
      ""
    )
    .replace(
      /All details are set! Are you ready to generate the game, or do you want to change anything\?/gi,
      ""
    )
    .replace(/[^.?!]*ready to generate[^.?!]*[.?!]?/gi, "")
    .replace(/[^.?!]*ready for the editor[^.?!]*[.?!]?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function appendMissingFieldQuestion(message, field) {
  const question = `**${FIELD_QUESTIONS[field]}**`;

  if (!message) {
    return `I am excited to build this with you. ${question}`;
  }

  if (message.includes(question)) {
    return message;
  }

  const separator = /[.?!]$/.test(message) ? " " : ". ";
  return `${message}${separator}${question}`;
}

function normalizeAssistantReply(rawReply) {
  let parsedReply;

  try {
    parsedReply = JSON.parse(rawReply);
  } catch (error) {
    throw new Error(`Invalid JSON returned from chat model: ${error.message}`);
  }

  const sourceBoardState =
    parsedReply?.boardState && typeof parsedReply.boardState === "object"
      ? parsedReply.boardState
      : parsedReply;

  const normalizedBoardState = BOARD_FIELDS.reduce((boardState, field) => {
    boardState[field] = normalizeBoardValue(sourceBoardState?.[field]);
    return boardState;
  }, {});

  const boardState = {
    ...EMPTY_BOARD_STATE,
    ...normalizedBoardState,
  };

  const firstMissingField = BOARD_FIELDS.find((field) => boardState[field] === "None");
  const rawMessage =
    typeof parsedReply?.message === "string" ? parsedReply.message.trim() : "";

  if (firstMissingField) {
    const cleanedMessage = stripPrematureCompletionText(rawMessage);

    return {
      message: appendMissingFieldQuestion(cleanedMessage, firstMissingField),
      boardState,
      isComplete: false,
    };
  }

  const fallbackMessage =
    parsedReply?.isComplete === true
      ? "Everything is locked in and ready for the editor."
      : CONFIRMATION_PROMPT;

  return {
    message: rawMessage || fallbackMessage,
    boardState,
    isComplete: parsedReply?.isComplete === true,
  };
}

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
      model: "deepseek-ai/DeepSeek-V3-0324",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messageHistory.map((message) => ({
          role: message.role,
          content:
            typeof message.content === "string"
              ? message.content
              : JSON.stringify(message.content),
        })),
      ],
    });

    const assistantReply = completion.choices?.[0]?.message?.content?.trim() || "";

    if (!assistantReply) {
      throw new Error("Chat model returned an empty response.");
    }

    const normalizedReply = normalizeAssistantReply(assistantReply);

    return new Response(JSON.stringify(normalizedReply), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
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
