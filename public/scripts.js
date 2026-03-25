const ideaForm = document.getElementById("idea-form");
const ideaInput = document.getElementById("game-idea");
const weaveButton = document.getElementById("weave-button");
const loadingMessage = document.getElementById("loading-message");
const yearNode = document.getElementById("year");

const chatOverlay = document.getElementById("chat-overlay");
const chatMessages = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatReplyInput = document.getElementById("chat-reply-input");
const chatSubmitButton = document.getElementById("chat-submit-button");
const chatCloseButton = document.getElementById("chat-close-button");

const messageHistory = [];
const loadingStages = [
  "Mapping mechanics, building a visual whiteboard, and preparing an HTML5 game shell.",
  "Synthesizing a first-pass gameplay loop and scene layout.",
  "Organizing the core genre, character, and win-condition details.",
];

let loadingIntervalId = null;
let thinkingIndicatorNode = null;

if (yearNode) {
  yearNode.textContent = new Date().getFullYear();
}

function setLoadingState(isLoading, initialText = loadingStages[0]) {
  if (!loadingMessage || !weaveButton) {
    return;
  }

  if (loadingIntervalId) {
    window.clearInterval(loadingIntervalId);
    loadingIntervalId = null;
  }

  if (isLoading) {
    weaveButton.disabled = true;
    weaveButton.setAttribute("aria-busy", "true");
    document.body.classList.add("is-loading");
    loadingMessage.textContent = initialText;

    let stageIndex = 0;
    loadingIntervalId = window.setInterval(() => {
      loadingMessage.textContent = loadingStages[stageIndex % loadingStages.length];
      stageIndex += 1;
    }, 1400);
    return;
  }

  document.body.classList.remove("is-loading");
  weaveButton.disabled = false;
  weaveButton.removeAttribute("aria-busy");
  loadingMessage.textContent = loadingStages[0];
}

function showChatOverlay() {
  if (!chatOverlay) {
    return;
  }

  chatOverlay.classList.remove("hidden");
  chatOverlay.classList.add("flex");
  chatOverlay.setAttribute("aria-hidden", "false");

  if (chatReplyInput) {
    window.setTimeout(() => chatReplyInput.focus(), 50);
  }
}

function hideChatOverlay() {
  if (!chatOverlay) {
    return;
  }

  chatOverlay.classList.add("hidden");
  chatOverlay.classList.remove("flex");
  chatOverlay.setAttribute("aria-hidden", "true");
}

function setChatInputState(isEnabled) {
  if (chatReplyInput) {
    chatReplyInput.disabled = !isEnabled;
  }

  if (chatSubmitButton) {
    chatSubmitButton.disabled = !isEnabled;
    chatSubmitButton.textContent = isEnabled ? "Send Reply" : "Thinking...";
  }
}

function scrollChatToBottom() {
  if (chatMessages) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function formatMessageContent(content) {
  const escapedContent = String(content)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  return escapedContent.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function createMessageElement(role, content, options = {}) {
  const row = document.createElement("div");
  row.className = `chat-message-row ${role === "user" ? "user" : "assistant"}`;

  const wrap = document.createElement("div");
  wrap.className = "chat-message-wrap";

  const meta = document.createElement("p");
  meta.className = "chat-meta";
  meta.textContent = role === "user" ? "You" : options.metaLabel || "PlayWeaver AI";

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble whitespace-pre-wrap ${role === "user" ? "user" : "assistant"}${
    options.isThinking ? " thinking" : ""
  }`;
  bubble.innerHTML = formatMessageContent(content);

  wrap.append(meta, bubble);
  row.appendChild(wrap);

  return row;
}

function appendMessage(role, content, options = {}) {
  if (!chatMessages) {
    return null;
  }

  const messageNode = createMessageElement(role, content, options);
  chatMessages.appendChild(messageNode);
  scrollChatToBottom();
  return messageNode;
}

function addThinkingIndicator() {
  removeThinkingIndicator();
  thinkingIndicatorNode = appendMessage("assistant", "Thinking...", { isThinking: true });
}

function removeThinkingIndicator() {
  if (thinkingIndicatorNode && thinkingIndicatorNode.parentNode) {
    thinkingIndicatorNode.parentNode.removeChild(thinkingIndicatorNode);
  }

  thinkingIndicatorNode = null;
}

function resetConversation() {
  messageHistory.length = 0;
  removeThinkingIndicator();
  hideChatOverlay();

  if (chatMessages) {
    chatMessages.innerHTML = "";
  }

  if (chatReplyInput) {
    chatReplyInput.value = "";
  }
}

function pushMessage(role, content) {
  messageHistory.push({ role, content });
}

async function handleAIResponse(result) {
  if (typeof result === "string") {
    setLoadingState(false);
    removeThinkingIndicator();
    setChatInputState(true);
    showChatOverlay();
    appendMessage("assistant", result);
    return;
  }

  if (result && typeof result === "object" && result.isComplete === true) {
    setLoadingState(false);
    removeThinkingIndicator();
    setChatInputState(true);
    return;
  }

  setLoadingState(false);
  removeThinkingIndicator();
  setChatInputState(true);
  showChatOverlay();
  appendMessage(
    "assistant",
    "I received an unexpected response. Please try answering again so I can finish your game board."
  );
}

async function requestAI() {
  if (typeof window.askPlayWeaverAI !== "function") {
    throw new Error("askPlayWeaverAI is not available on window.");
  }

  return window.askPlayWeaverAI(messageHistory);
}

async function handleInitialIdeaSubmit(event) {
  event.preventDefault();

  if (!ideaInput) {
    return;
  }

  const prompt = ideaInput.value.trim();

  if (!prompt) {
    ideaInput.focus();
    return;
  }

  resetConversation();
  pushMessage("user", prompt);
  appendMessage("user", prompt);
  setLoadingState(true, `Weaving: ${prompt}`);

  try {
    const result = await requestAI();
    await handleAIResponse(result);
  } catch (error) {
    console.error("Initial PlayWeaver request failed:", error);
    setLoadingState(false);
    setChatInputState(true);
    showChatOverlay();
    appendMessage(
      "assistant",
      "Something went wrong while contacting PlayWeaver. Please try again in a moment."
    );
  }
}

async function handleChatReplySubmit(event) {
  event.preventDefault();

  if (!chatReplyInput) {
    return;
  }

  const reply = chatReplyInput.value.trim();

  if (!reply) {
    chatReplyInput.focus();
    return;
  }

  pushMessage("user", reply);
  appendMessage("user", reply);
  chatReplyInput.value = "";
  setChatInputState(false);
  addThinkingIndicator();

  try {
    const result = await requestAI();
    await handleAIResponse(result);
  } catch (error) {
    console.error("Follow-up PlayWeaver request failed:", error);
    removeThinkingIndicator();
    setChatInputState(true);
    appendMessage(
      "assistant",
      "I hit a snag while processing that answer. Please resend your reply and we can keep going."
    );
  }
}

if (ideaForm) {
  ideaForm.addEventListener("submit", handleInitialIdeaSubmit);
}

if (chatForm) {
  chatForm.addEventListener("submit", handleChatReplySubmit);
}

if (chatCloseButton) {
  chatCloseButton.addEventListener("click", hideChatOverlay);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && chatOverlay && !chatOverlay.classList.contains("hidden")) {
    hideChatOverlay();
  }
});
