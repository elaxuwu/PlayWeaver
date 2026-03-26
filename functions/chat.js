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

const READY_CONFIRMATION_PATTERNS = [
  /^(yes|yep|yeah|sure|ok|okay|ready|proceed|continue|do it|go ahead)\b/i,
  /\b(i am|i'm|im)\s+ready\b/i,
  /\b(generate|build|make)\s+(it|the game)\b/i,
  /\b(go ahead and|please)\s+(generate|build|make)\b/i,
  /\b(looks good|sounds good|all set|no changes|nothing to change)\b/i,
  /\b(let'?s go|let'?s do it)\b/i,
];

function normalizeBoardValue(value) {
  if (typeof value !== "string") {
    return "None";
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : "None";
}

function getLatestMessageContent(messageHistory, role) {
  if (!Array.isArray(messageHistory)) {
    return "";
  }

  for (let index = messageHistory.length - 1; index >= 0; index -= 1) {
    const message = messageHistory[index];

    if (message?.role === role && typeof message.content === "string") {
      return message.content;
    }
  }

  return "";
}

function userExplicitlyConfirmed(messageHistory) {
  const latestUserMessage = getLatestMessageContent(messageHistory, "user").trim();

  return READY_CONFIRMATION_PATTERNS.some((pattern) => pattern.test(latestUserMessage));
}

function assistantAskedForConfirmation(messageHistory) {
  return getLatestMessageContent(messageHistory, "assistant").includes(CONFIRMATION_MESSAGE);
}

function normalizeAssistantReply(rawReply, options = {}) {
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
  const hasCompleteBoard = BOARD_FIELDS.every(
    (field) => normalizedBoardState[field] !== "None"
  );
  const canComplete = options.allowCompletion === true && hasCompleteBoard;
  const fallbackMessage = firstMissingField
    ? `I am excited to build this with you. **${FIELD_QUESTIONS[firstMissingField]}**`
    : canComplete
      ? "Everything is locked in and ready for the editor."
      : CONFIRMATION_PROMPT;

  const message =
    typeof parsedReply?.message === "string" && parsedReply.message.trim()
      ? parsedReply.message.trim()
      : fallbackMessage;

  return {
    message,
    boardState: {
      ...EMPTY_BOARD_STATE,
      ...normalizedBoardState,
    },
    isComplete: parsedReply?.isComplete === true && canComplete,
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

    const allowCompletion =
      assistantAskedForConfirmation(messageHistory) &&
      userExplicitlyConfirmed(messageHistory);

    const completion = await client.chat.completions.create({
      model: "deepseek-ai/DeepSeek-V3-0324",
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
    const normalizedReply = normalizeAssistantReply(assistantReply, {
      allowCompletion,
    });

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
