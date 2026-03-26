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

const SYSTEM_PROMPT = `You are PlayWeaver, a highly enthusiastic, natural, and friendly game design partner.
Your job is to gather exactly 8 parameters for a game concept: gameName, genre, coreMechanic, artStyle, setting, playerCharacter, enemies, winCondition.

You must follow these rules on every single turn:
1. Always output a strict JSON object and nothing else.
2. The JSON must always use this exact shape:
{"message":"Your friendly response here","boardState":{"gameName":"None","genre":"None","coreMechanic":"None","artStyle":"None","setting":"None","playerCharacter":"None","enemies":"None","winCondition":"None"},"isComplete":false}
3. Every boardState key must be present on every turn. Fill each value with the best extracted value from the full conversation so far. If a value is still missing or unclear, set it to "None".
4. Be upbeat, natural, and collaborative. You may include one or two brief creative suggestions to help the user brainstorm.
5. Ask for only ONE missing parameter at a time.
6. Only bold the main question inside the "message" field. Do not bold suggestions, examples, encouragement, or any other text.
7. If all 8 parameters are clearly defined, stop asking questions, set "isComplete" to true, and keep the message warm and celebratory.
8. Never wrap the JSON in markdown or code fences. Never add commentary outside the JSON object.`;

function normalizeBoardValue(value) {
  if (typeof value !== "string") {
    return "None";
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : "None";
}

function normalizeAssistantReply(rawReply) {
  const parsedReply = JSON.parse(rawReply);
  const sourceBoardState =
    parsedReply?.boardState && typeof parsedReply.boardState === "object"
      ? parsedReply.boardState
      : parsedReply;

  const normalizedBoardState = BOARD_FIELDS.reduce((boardState, field) => {
    boardState[field] = normalizeBoardValue(sourceBoardState?.[field]);
    return boardState;
  }, {});

  const firstMissingField = BOARD_FIELDS.find(
    (field) => normalizedBoardState[field] === "None"
  );
  const fallbackMessage = firstMissingField
    ? `I am excited to build this with you. **${FIELD_QUESTIONS[firstMissingField]}**`
    : "Everything is locked in and ready for the editor.";

  const message =
    typeof parsedReply?.message === "string" && parsedReply.message.trim()
      ? parsedReply.message.trim()
      : fallbackMessage;

  const hasCompleteBoard = BOARD_FIELDS.every(
    (field) => normalizedBoardState[field] !== "None"
  );

  return {
    message,
    boardState: {
      ...EMPTY_BOARD_STATE,
      ...normalizedBoardState,
    },
    isComplete: parsedReply?.isComplete === true && hasCompleteBoard,
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
      model: "Qwen/Qwen2.5-7B-Instruct",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messageHistory.map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        })),
      ],
    });

    const assistantReply = completion.choices?.[0]?.message?.content?.trim() || "";
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
