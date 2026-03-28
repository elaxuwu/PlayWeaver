import OpenAI from "openai";

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
{"reply":"Friendly message to the user","actions":[{"type":"ADD_NODE","label":"Dodging","category":"coreMechanic"},{"type":"REMOVE_NODE","label":"Node Text To Delete"},{"type":"EDIT_NODE","targetLabel":"Old Text","newLabel":"New Text"}]}

Rules:
- "reply" must always be a friendly plain-text string.
- "actions" must always be an array.
- The only supported action types are "ADD_NODE", "REMOVE_NODE", and "EDIT_NODE".
- Valid categories for "ADD_NODE" are exactly: gameName, genre, coreMechanic, artStyle, setting, playerCharacter, enemies, winCondition.
- Use "ADD_NODE" only when the user clearly wants the editor canvas changed.
- Use "REMOVE_NODE" when the user wants a node deleted by label.
- Use "EDIT_NODE" when the user wants an existing node label changed.
- If the user is only chatting or asking for advice without a canvas change, return an empty "actions" array.
- Keep "label" short and suitable for a node label.
- For "REMOVE_NODE", include only {"type":"REMOVE_NODE","label":"Exact or close node text"}.
- For "EDIT_NODE", include only {"type":"EDIT_NODE","targetLabel":"Existing text","newLabel":"Updated text"}.
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
    const { message, messageHistory } = await context.request.json();
    const normalizedMessage = typeof message === "string" ? message.trim() : "";

    if (!normalizedMessage) {
      return jsonResponse({ error: "message is required" }, 400);
    }

    if (!context.env.FEATHERLESS_API_KEY) {
      throw new Error("Missing FEATHERLESS_API_KEY environment variable");
    }

    const client = new OpenAI({
      apiKey: context.env.FEATHERLESS_API_KEY,
      baseURL: "https://api.featherless.ai/v1",
    });

    const completion = await client.chat.completions.create({
      model: "deepseek-ai/DeepSeek-V3-0324",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        ...normalizeMessageHistory(messageHistory),
        {
          role: "user",
          content: normalizedMessage,
        },
      ],
    });

    const assistantReply = completion.choices?.[0]?.message?.content?.trim() || "";

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
