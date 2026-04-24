import { createChatCompletionWithFallback } from "./ai-chat-provider.js";

const VALID_CATEGORIES = [
  "gameName",
  "genre",
  "coreMechanic",
  "artStyle",
  "setting",
  "playerCharacter",
  "enemies",
  "winCondition",
];

const SYSTEM_PROMPT = `You are an expert game design assistant embedded inside the PlayWeaver node-based editor.
You must ONLY reply with valid JSON matching this exact schema and nothing else:
{"reply":"Friendly message to the user","actions":[{"type":"ADD_NODE","label":"Dodging","category":"coreMechanic"},{"type":"REMOVE_NODE","label":"Node Text To Delete"},{"type":"EDIT_NODE","targetLabel":"Old Text","newLabel":"New Text"},{"type":"ADD_NOTE","text":"Specific instructions or bug fixes"},{"type":"ADD_IMAGE_ASSET","targetCategory":"playerCharacter","description":"What the image represents"}]}

Rules:
- "reply" must always be a friendly plain-text string.
- "actions" must always be an array.
- The only supported action types are "ADD_NODE", "REMOVE_NODE", "EDIT_NODE", "ADD_NOTE", and "ADD_IMAGE_ASSET".
- Valid categories for "ADD_NODE" are exactly: gameName, genre, coreMechanic, artStyle, setting, playerCharacter, enemies, winCondition.
- Valid targetCategory values for "ADD_IMAGE_ASSET" are exactly: gameName, genre, coreMechanic, artStyle, setting, playerCharacter, enemies, winCondition.
- Use "ADD_NODE" only when the user clearly wants the editor canvas changed.
- Use "REMOVE_NODE" when the user wants a node deleted by label.
- Use "EDIT_NODE" when the user wants an existing node label changed.
- Use "ADD_NOTE" whenever the user asks for a specific code change, bug fix, balance tweak, stat tweak, or implementation reminder that does not fit cleanly into the main game categories.
- If the user message contains the tag [User attached an image reference] and the user wants that image included in the game, use "ADD_IMAGE_ASSET".
- If the user is only chatting or asking for advice without a canvas change, return an empty "actions" array.
- Keep "label" short and suitable for a node label.
- For "REMOVE_NODE", include only {"type":"REMOVE_NODE","label":"Exact or close node text"}.
- For "EDIT_NODE", include only {"type":"EDIT_NODE","targetLabel":"Existing text","newLabel":"Updated text"}.
- For "ADD_NOTE", include only {"type":"ADD_NOTE","text":"Specific instructions or bug fixes"}.
- For "ADD_IMAGE_ASSET", include only {"type":"ADD_IMAGE_ASSET","targetCategory":"playerCharacter","description":"What the image represents"}.
- Never return markdown, code fences, or any text outside the JSON object.`;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function stripJsonCodeFences(content) {
  return String(content || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeMessageHistory(messageHistory) {
  if (!Array.isArray(messageHistory)) {
    return [];
  }

  return messageHistory
    .map((message) => {
      const role = message?.role === "assistant" ? "assistant" : message?.role === "user" ? "user" : "";
      const content = typeof message?.content === "string" ? message.content.trim() : "";

      if (!role || !content) {
        return null;
      }

      return {
        role,
        content,
      };
    })
    .filter(Boolean);
}

function normalizeCategory(category) {
  const normalizedCategory = typeof category === "string" ? category.trim() : "";
  return VALID_CATEGORIES.includes(normalizedCategory) ? normalizedCategory : "";
}

function normalizeAction(action) {
  if (!action || typeof action !== "object") {
    return null;
  }

  if (action.type === "ADD_NODE") {
    const label = typeof action.label === "string" ? action.label.trim() : "";
    const category = normalizeCategory(action.category);

    if (!label || !category) {
      return null;
    }

    return {
      type: "ADD_NODE",
      label,
      category,
    };
  }

  if (action.type === "REMOVE_NODE") {
    const label = typeof action.label === "string" ? action.label.trim() : "";

    if (!label) {
      return null;
    }

    return {
      type: "REMOVE_NODE",
      label,
    };
  }

  if (action.type === "EDIT_NODE") {
    const targetLabel = typeof action.targetLabel === "string" ? action.targetLabel.trim() : "";
    const newLabel = typeof action.newLabel === "string" ? action.newLabel.trim() : "";

    if (!targetLabel || !newLabel) {
      return null;
    }

    return {
      type: "EDIT_NODE",
      targetLabel,
      newLabel,
    };
  }

  if (action.type === "ADD_NOTE") {
    const text = typeof action.text === "string" ? action.text.trim() : "";

    if (!text) {
      return null;
    }

    return {
      type: "ADD_NOTE",
      text,
    };
  }

  if (action.type === "ADD_IMAGE_ASSET") {
    const targetCategory = normalizeCategory(action.targetCategory);
    const description = typeof action.description === "string" ? action.description.trim() : "";

    if (!targetCategory || !description) {
      return null;
    }

    return {
      type: "ADD_IMAGE_ASSET",
      targetCategory,
      description,
    };
  }

  return null;
}

function normalizeAssistantPayload(rawContent) {
  let parsedPayload = null;

  try {
    parsedPayload = JSON.parse(stripJsonCodeFences(rawContent));
  } catch (error) {
    throw new Error(`Invalid JSON returned from editor chat model: ${error.message}`);
  }

  const reply =
    typeof parsedPayload?.reply === "string" && parsedPayload.reply.trim()
      ? parsedPayload.reply.trim()
      : "I updated the board suggestion for you.";

  const actions = Array.isArray(parsedPayload?.actions)
    ? parsedPayload.actions.map(normalizeAction).filter(Boolean)
    : [];

  return {
    reply,
    actions,
  };
}

export async function onRequestPost(context) {
  try {
    const { message, messageHistory, gameConfig } = await context.request.json();
    const normalizedMessage = typeof message === "string" ? message.trim() : "";

    if (!normalizedMessage) {
      return jsonResponse({ error: "message is required" }, 400);
    }

    const currentGameConfig =
      gameConfig && typeof gameConfig === "object" ? JSON.stringify(gameConfig, null, 2) : "{}";
    const dynamicSystemPrompt = `${SYSTEM_PROMPT}\n\nThe current game configuration is:\n${currentGameConfig}\nUse this context to answer the user accurately.`;

    const assistantReply = await createChatCompletionWithFallback({
      context,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: dynamicSystemPrompt,
        },
        ...normalizeMessageHistory(messageHistory),
        {
          role: "user",
          content: normalizedMessage,
        },
      ],
    });

    if (!assistantReply) {
      throw new Error("Editor chat model returned an empty response.");
    }

    return jsonResponse(normalizeAssistantPayload(assistantReply));
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unable to process the editor assistant request.",
      },
      500
    );
  }
}
