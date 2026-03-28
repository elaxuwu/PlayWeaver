(function () {
  const STORAGE_KEY = "playweaverGameConfig";
  const EDITOR_STATE_KEY = "playweaverEditorStateV2";
  const EDITOR_STATE_VERSION = 4;
  const READY_STATUS = "Ready to generate a playable prototype.";
  const GRID_SIZE = 56;
  const MIN_ZOOM = 0.45;
  const MAX_ZOOM = 2.4;
  const CLOUD_SYNC_DEBOUNCE_MS = 1500;
  const DEBUG_SEQUENCE = ["w", "w", "a", "a", "s", "s", "d", "d"];
  const EDITOR_ASSISTANT_HISTORY_LIMIT = 16;
  const BASE64_IMAGE_PATTERN = /data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=_-\s]+/gi;
  const GAME_ASSET_PLACEHOLDER_SRC =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  const FIELD_DEFINITIONS = [
    { key: "gameName", label: "Game Name" },
    { key: "genre", label: "Genre" },
    { key: "coreMechanic", label: "Core Mechanic" },
    { key: "artStyle", label: "Art Style" },
    { key: "setting", label: "Setting" },
    { key: "playerCharacter", label: "Player Character" },
    { key: "enemies", label: "Enemies" },
    { key: "winCondition", label: "Win Condition" },
  ];
  const BASE_FIELDS = FIELD_DEFINITIONS.filter((field) => field.key !== "gameName");
  const FIELD_IDS = new Set(BASE_FIELDS.map((field) => field.key));
  const ROOT_NODE_IDS = ["title"];
  const NODE_COLORS = [
    {
      id: "sky",
      surface: "#0f2748",
      border: "#7dd3fc",
      glow: "rgba(125, 211, 252, 0.3)",
      ink: "#e0f2fe",
    },
    {
      id: "mint",
      surface: "#0f2f28",
      border: "#6ee7b7",
      glow: "rgba(110, 231, 183, 0.26)",
      ink: "#dcfce7",
    },
    {
      id: "gold",
      surface: "#35230a",
      border: "#fbbf24",
      glow: "rgba(251, 191, 36, 0.28)",
      ink: "#fef3c7",
    },
    {
      id: "rose",
      surface: "#3a1121",
      border: "#fb7185",
      glow: "rgba(251, 113, 133, 0.26)",
      ink: "#ffe4e6",
    },
    {
      id: "violet",
      surface: "#241743",
      border: "#c4b5fd",
      glow: "rgba(196, 181, 253, 0.28)",
      ink: "#f5f3ff",
    },
    {
      id: "slate",
      surface: "#182339",
      border: "#94a3b8",
      glow: "rgba(148, 163, 184, 0.24)",
      ink: "#e2e8f0",
    },
  ];
  const DEFAULT_COLORS = {
    title: "sky",
    field: "slate",
    note: "mint",
  };

  if (document.body?.dataset?.page !== "editor") {
    return;
  }

  const summaryName = document.getElementById("summary-name");
  const summaryGenre = document.getElementById("summary-genre");
  const generateBtn = document.getElementById("generate-btn");
  const openTabBtn = document.getElementById("open-tab-btn");
  const nodeCount = document.getElementById("node-count");
  const linkCount = document.getElementById("link-count");
  const boardCanvas = document.getElementById("board-canvas");
  const boardStage = document.getElementById("board-stage");
  const boardNodes = document.getElementById("board-nodes");
  const boardLinks = document.getElementById("board-links");
  const canvasContextMenu = document.getElementById("canvas-context-menu");
  const linkHint = document.getElementById("link-hint");
  const generateStatus = document.getElementById("generate-status");
  const gameFrame = document.getElementById("game-frame");
  const gameLoadingOverlay = document.getElementById("game-loading-overlay");
  const gameLoadingText = document.getElementById("game-loading-text");
  const downloadGameBtn = document.getElementById("download-game-btn");
  const previewCard = document.querySelector(".preview-card");
  const previewBackdrop = document.getElementById("preview-backdrop");
  const previewSizeToggleBtn = document.getElementById("preview-size-toggle-btn");
  const previewSizeToggleIcon = document.getElementById("preview-size-toggle-icon");
  const editNodeModal = document.getElementById("edit-node-modal");
  const editNodeModalBackdrop = document.getElementById("edit-node-modal-backdrop");
  const editNodeInput = document.getElementById("edit-node-input");
  const editNodeSaveBtn = document.getElementById("edit-node-save-btn");
  const editNodeCancelBtn = document.getElementById("edit-node-cancel-btn");
  const debugPanel = document.getElementById("debug-panel");
  const debugPayload = document.getElementById("debug-payload");
  const editorAssistantPanel = document.getElementById("editor-assistant-panel");
  const editorAssistantHistory = document.getElementById("editor-assistant-history");
  const editorAssistantForm = document.getElementById("editor-assistant-form");
  const editorAssistantInput = document.getElementById("editor-assistant-input");
  const editorAssistantImageInput = document.getElementById("editor-assistant-image-input");
  const editorAssistantUpload = document.getElementById("editor-assistant-upload");
  const editorAssistantImagePreview = document.getElementById("editor-assistant-image-preview");
  const editorAssistantImageThumb = document.getElementById("editor-assistant-image-thumb");
  const editorAssistantImageName = document.getElementById("editor-assistant-image-name");
  const editorAssistantClearImage = document.getElementById("editor-assistant-clear-image");
  const editorAssistantSend = document.getElementById("editor-assistant-send");
  const editorAssistantFab = document.getElementById("editor-assistant-fab");

  if (!boardCanvas || !boardStage || !boardNodes || !boardLinks || !canvasContextMenu) {
    return;
  }

  const editorState = {
    nodes: [],
    links: [],
    pan: defaultPan(),
    zoom: 1,
    selectedNodeId: null,
    draggingNodeId: null,
    dragPointerOffset: { x: 0, y: 0 },
    panning: null,
    linking: null,
    currentGeneratedHtml: "",
    currentPrototypeUrl: null,
    nodeIdCounter: 0,
    renderQueued: false,
    contextMenu: null,
    editingNodeId: null,
    debugVisible: false,
    debugKeyHistory: [],
    chatHistory: [],
    assistantChatOpen: false,
    assistantChatPending: false,
  };
  let cloudSyncTimeoutId = null;
  let pendingChatImage = null;

  function defaultPan() {
    return {
      x: 0,
      y: 0,
    };
  }

  function getDefaultGameConfig() {
    const config = FIELD_DEFINITIONS.reduce((nextConfig, field) => {
      nextConfig[field.key] = field.key === "gameName" ? "Untitled Game" : "None";
      return nextConfig;
    }, {});

    config.developerNotes = [];
    config.imageAssets = [];
    return config;
  }

  function normalizeStoredValue(value, fallback) {
    if (typeof value !== "string") {
      return fallback;
    }

    const trimmedValue = value.trim();
    return trimmedValue || fallback;
  }

  function normalizeEditableText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeGameConfig(config) {
    const defaults = getDefaultGameConfig();
    const normalizedConfig = FIELD_DEFINITIONS.reduce((normalized, field) => {
      normalized[field.key] = normalizeStoredValue(config?.[field.key], defaults[field.key]);
      return normalized;
    }, {});

    normalizedConfig.developerNotes = Array.isArray(config?.developerNotes)
      ? config.developerNotes
          .map((note) => (typeof note === "string" ? note.trim() : ""))
          .filter(Boolean)
      : [];

    normalizedConfig.imageAssets = Array.isArray(config?.imageAssets)
      ? config.imageAssets
          .map((asset) => {
            const targetCategory =
              typeof asset?.targetCategory === "string" ? asset.targetCategory.trim() : "";
            const imageData = typeof asset?.imageData === "string" ? asset.imageData.trim() : "";
            const description =
              typeof asset?.description === "string" ? asset.description.trim() : "";

            if (!targetCategory || !imageData) {
              return null;
            }

            return {
              targetCategory,
              imageData,
              description,
            };
          })
          .filter(Boolean)
      : [];

    return normalizedConfig;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatAssistantMessage(value) {
    return escapeHtml(value).replace(/\n/g, "<br>");
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function positiveModulo(value, divisor) {
    if (!divisor) {
      return 0;
    }

    return ((value % divisor) + divisor) % divisor;
  }

  function getBoardMetrics() {
    const rect = boardCanvas.getBoundingClientRect();
    const width = rect.width || boardCanvas.clientWidth || window.innerWidth;
    const height = rect.height || boardCanvas.clientHeight || window.innerHeight;

    return {
      width,
      height,
      centerX: width / 2,
      centerY: height / 2,
    };
  }

  function getColorToken(colorId, kind) {
    return (
      NODE_COLORS.find((preset) => preset.id === colorId) ||
      NODE_COLORS.find((preset) => preset.id === DEFAULT_COLORS[kind]) ||
      NODE_COLORS[0]
    );
  }

  function getNodeById(nodeId) {
    return editorState.nodes.find((node) => node.id === nodeId) || null;
  }

  function isRootNode(node) {
    return Boolean(node && (node.kind === "title" || ROOT_NODE_IDS.includes(node.id)));
  }

  function canStartManualLink(nodeId) {
    const node = getNodeById(nodeId);
    return Boolean(node && !isRootNode(node) && (node.kind === "field" || node.kind === "note"));
  }

  function canCreateManualLink(fromNodeId, toNodeId) {
    const fromNode = getNodeById(fromNodeId);
    const toNode = getNodeById(toNodeId);

    if (!fromNode || !toNode || fromNode.id === toNode.id) {
      return false;
    }

    if (isRootNode(fromNode) || isRootNode(toNode)) {
      return false;
    }

    return (
      (fromNode.kind === "field" && toNode.kind === "note") ||
      (fromNode.kind === "note" && toNode.kind === "field")
    );
  }

  function getNodeIndex(nodeId) {
    return editorState.nodes.findIndex((node) => node.id === nodeId);
  }

  function getNodeElement(nodeId) {
    return boardNodes.querySelector(`.board-node[data-node-id="${nodeId}"]`);
  }

  function getNodeWidth(node) {
    if (node.isImageAsset) {
      return window.innerWidth <= 720 ? 184 : 212;
    }

    if (node.kind === "title") {
      return window.innerWidth <= 720 ? 240 : 272;
    }

    if (node.kind === "field") {
      return 192;
    }

    return window.innerWidth <= 720 ? 224 : 256;
  }

  function getNodeHeight(node) {
    if (node.isImageAsset) {
      return window.innerWidth <= 720 ? 176 : 194;
    }

    if (node.kind === "title") {
      return 110;
    }

    if (node.kind === "field") {
      return 92;
    }

    return 98;
  }

  function nodeToScreenPosition(node) {
    return {
      x: node.x,
      y: node.y,
    };
  }

  function getNodeCenter(nodeId) {
    const node = getNodeById(nodeId);

    if (!node) {
      return null;
    }

    const nodeElement = getNodeElement(nodeId);

    if (nodeElement) {
      return {
        x: nodeElement.offsetLeft + nodeElement.offsetWidth / 2,
        y: nodeElement.offsetTop + nodeElement.offsetHeight / 2,
      };
    }

    const position = nodeToScreenPosition(node);
    return {
      x: position.x + getNodeWidth(node) / 2,
      y: position.y + getNodeHeight(node) / 2,
    };
  }

  function clientToWorld(clientX, clientY) {
    const rect = boardCanvas.getBoundingClientRect();
    const { centerX, centerY } = getBoardMetrics();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const zoom = editorState.zoom;

    return {
      x: (localX - (1 - zoom) * centerX) / zoom - editorState.pan.x,
      y: (localY - (1 - zoom) * centerY) / zoom - editorState.pan.y,
    };
  }

  function createNodeId(prefix) {
    editorState.nodeIdCounter += 1;
    return `${prefix}_${Date.now()}_${editorState.nodeIdCounter}`;
  }

  function createLinkId(fromNodeId, toNodeId) {
    return `link_${fromNodeId}_${toNodeId}_${Date.now()}_${editorState.links.length + 1}`;
  }

  function createNode(label, type, options = {}) {
    const normalizedType =
      type === "title" || type === "field" || type === "note" || type === "Node"
        ? type
        : "note";
    const kind = normalizedType === "Node" ? "note" : normalizedType;
    const fallbackLabel =
      kind === "title" ? "Untitled Game" : kind === "field" ? "Category" : "New note";

    return {
      id: createNodeId(kind === "title" ? "title" : kind === "field" ? "field" : "note"),
      kind,
      label: normalizeStoredValue(label, fallbackLabel),
      x: Number.isFinite(options.x) ? options.x : 0,
      y: Number.isFinite(options.y) ? options.y : 0,
      locked: Boolean(options.locked),
      isNote: Boolean(options.isNote),
      isImageAsset: Boolean(options.isImageAsset),
      imageData: typeof options.imageData === "string" ? options.imageData : "",
      targetCategory: typeof options.targetCategory === "string" ? options.targetCategory : "",
      colorId:
        typeof options.colorId === "string" && options.colorId
          ? options.colorId
          : options.isNote
            ? "gold"
          : DEFAULT_COLORS[kind],
    };
  }

  function createConfigSignature(config) {
    return JSON.stringify(normalizeGameConfig(config));
  }

  function createInitialBoardState(config) {
    const normalizedConfig = normalizeGameConfig(config);
    const { centerX, centerY, width, height } = getBoardMetrics();
    const titlePrototype = { kind: "title" };
    const fieldPrototype = { kind: "field" };
    const notePrototype = { kind: "note" };
    const titleWidth = getNodeWidth(titlePrototype);
    const titleHeight = getNodeHeight(titlePrototype);
    const fieldWidth = getNodeWidth(fieldPrototype);
    const fieldHeight = getNodeHeight(fieldPrototype);
    const noteWidth = getNodeWidth(notePrototype);
    const noteHeight = getNodeHeight(notePrototype);
    const rootCenter = { x: centerX, y: centerY };
    const categoryRadius = Math.max(240, Math.min(width, height) * 0.24 + 72);
    const noteOffsetRadius = Math.max(196, Math.min(width, height) * 0.14 + 92);
    const nodes = [
      {
        id: "title",
        kind: "title",
        label: normalizeStoredValue(normalizedConfig.gameName, "Untitled Game"),
        x: rootCenter.x - titleWidth / 2,
        y: rootCenter.y - titleHeight / 2,
        locked: false,
        colorId: "sky",
      },
    ];
    const links = [];

    BASE_FIELDS.forEach((field, index) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / BASE_FIELDS.length;
      const unitX = Math.cos(angle);
      const unitY = Math.sin(angle);
      const fieldCenter = {
        x: rootCenter.x + categoryRadius * unitX,
        y: rootCenter.y + categoryRadius * unitY,
      };
      const noteCenter = {
        x: fieldCenter.x + noteOffsetRadius * unitX,
        y: fieldCenter.y + noteOffsetRadius * unitY,
      };
      const noteColor = NODE_COLORS[(index + 1) % NODE_COLORS.length]?.id || "mint";

      nodes.push({
        id: field.key,
        kind: "field",
        label: field.label,
        x: fieldCenter.x - fieldWidth / 2,
        y: fieldCenter.y - fieldHeight / 2,
        locked: true,
        colorId: "slate",
      });

      nodes.push({
        id: `${field.key}_value`,
        kind: "note",
        label: normalizeStoredValue(normalizedConfig[field.key], "None"),
        x: noteCenter.x - noteWidth / 2,
        y: noteCenter.y - noteHeight / 2,
        locked: false,
        colorId: noteColor,
      });

      links.push({
        id: `link_title_${field.key}`,
        from: "title",
        to: field.key,
      });

      links.push({
        id: `link_${field.key}`,
        from: field.key,
        to: `${field.key}_value`,
      });
    });

    return {
      nodes,
      links,
      pan: defaultPan(),
      zoom: 1,
      signature: createConfigSignature(normalizedConfig),
      html: "",
      chatHistory: [],
    };
  }

  function normalizeBoardState(rawState) {
    if (!rawState || typeof rawState !== "object") {
      return null;
    }

    if (Number(rawState.version) !== EDITOR_STATE_VERSION) {
      return null;
    }

    const rawNodes = Array.isArray(rawState.nodes) ? rawState.nodes : null;
    const rawLinks = Array.isArray(rawState.links) ? rawState.links : [];

    if (!rawNodes) {
      return null;
    }

    const nodes = rawNodes
      .map((node) => {
        if (!node || typeof node !== "object" || typeof node.id !== "string") {
          return null;
        }

        const kind = ["title", "field", "note"].includes(node.kind) ? node.kind : "note";
        const x = Number(node.x);
        const y = Number(node.y);

        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return null;
        }

        return {
          id: node.id,
          kind,
          label: normalizeStoredValue(
            node.label,
            kind === "title" ? "Untitled Game" : kind === "field" ? "Field" : "New note"
          ),
          x,
          y,
          locked: Boolean(node.locked || kind === "field"),
          isNote: Boolean(node.isNote),
          isImageAsset: Boolean(node.isImageAsset),
          imageData: typeof node.imageData === "string" ? node.imageData : "",
          targetCategory: typeof node.targetCategory === "string" ? node.targetCategory : "",
          colorId: typeof node.colorId === "string" ? node.colorId : DEFAULT_COLORS[kind],
        };
      })
      .filter(Boolean);

    if (!nodes.length || !nodes.some((node) => node.id === "title" && node.kind === "title")) {
      return null;
    }

    const nodeIds = new Set(nodes.map((node) => node.id));

    if (!BASE_FIELDS.every((field) => nodeIds.has(field.key))) {
      return null;
    }

    const links = rawLinks
      .map((link) => {
        if (!link || typeof link !== "object") {
          return null;
        }

        const from = typeof link.from === "string" ? link.from : "";
        const to = typeof link.to === "string" ? link.to : "";

        if (!from || !to || from === to || !nodeIds.has(from) || !nodeIds.has(to)) {
          return null;
        }

        return {
          id: typeof link.id === "string" && link.id ? link.id : `link_${from}_${to}`,
          from,
          to,
        };
      })
      .filter(Boolean);

    const panX = Number(rawState.pan?.x);
    const panY = Number(rawState.pan?.y);
    const zoom = Number(rawState.zoom);
    const fallbackPan = defaultPan();
    const chatHistorySource = Array.isArray(rawState.chatHistory)
      ? rawState.chatHistory
      : Array.isArray(rawState.assistantChatHistory)
        ? rawState.assistantChatHistory
        : [];

    return {
      nodes,
      links,
      pan: {
        x: Number.isFinite(panX) ? panX : fallbackPan.x,
        y: Number.isFinite(panY) ? panY : fallbackPan.y,
      },
      zoom: Number.isFinite(zoom) ? clamp(zoom, MIN_ZOOM, MAX_ZOOM) : 1,
      signature: typeof rawState.signature === "string" ? rawState.signature : "",
      html: typeof rawState.html === "string" ? rawState.html : "",
      chatHistory: normalizeAssistantHistory(chatHistorySource),
    };
  }

  function loadInitialConfig() {
    try {
      const rawConfig = localStorage.getItem(STORAGE_KEY);

      if (!rawConfig) {
        return getDefaultGameConfig();
      }

      return normalizeGameConfig(JSON.parse(rawConfig));
    } catch (error) {
      console.error("Failed to read PlayWeaver config:", error);
      return getDefaultGameConfig();
    }
  }

  function loadBoardState(initialConfig) {
    try {
      const rawBoardState = localStorage.getItem(EDITOR_STATE_KEY);

      if (!rawBoardState) {
        return createInitialBoardState(initialConfig);
      }

      const parsedBoardState = normalizeBoardState(JSON.parse(rawBoardState));

      if (!parsedBoardState) {
        return createInitialBoardState(initialConfig);
      }

      const configSignature = createConfigSignature(initialConfig);

      if (parsedBoardState.signature && parsedBoardState.signature !== configSignature) {
        return createInitialBoardState(initialConfig);
      }

      return parsedBoardState;
    } catch (error) {
      console.error("Failed to read editor board state:", error);
      return createInitialBoardState(initialConfig);
    }
  }

  function setGenerateStatus(message) {
    if (generateStatus) {
      generateStatus.textContent = message;
    }
  }

  function normalizeAssistantHistoryMessage(message) {
    const role = message?.role === "assistant" ? "assistant" : message?.role === "user" ? "user" : "";
    const content = typeof message?.content === "string" ? message.content.trim() : "";

    if (!role || !content) {
      return null;
    }

    return {
      role,
      content,
    };
  }

  function normalizeAssistantHistory(messages) {
    if (!Array.isArray(messages)) {
      return [];
    }

    return messages
      .map(normalizeAssistantHistoryMessage)
      .filter(Boolean)
      .slice(-EDITOR_ASSISTANT_HISTORY_LIMIT);
  }

  function ensureAssistantChatHistory() {
    if (!Array.isArray(editorState.chatHistory)) {
      editorState.chatHistory = [];
    }

    return editorState.chatHistory;
  }

  function setEditorAssistantPending(isPending) {
    editorState.assistantChatPending = Boolean(isPending);

    if (editorAssistantInput) {
      editorAssistantInput.disabled = editorState.assistantChatPending;
    }

    if (editorAssistantUpload) {
      editorAssistantUpload.disabled = editorState.assistantChatPending;
    }

    if (editorAssistantSend) {
      editorAssistantSend.disabled = editorState.assistantChatPending;
      editorAssistantSend.textContent = editorState.assistantChatPending ? "Sending..." : "Send";
    }
  }

  function renderPendingChatImagePreview(fileName) {
    if (
      !editorAssistantImagePreview ||
      !editorAssistantImageThumb ||
      !editorAssistantImageName ||
      !editorAssistantClearImage
    ) {
      return;
    }

    const hasPendingImage = typeof pendingChatImage === "string" && pendingChatImage.trim();
    editorAssistantImagePreview.classList.toggle("hidden", !hasPendingImage);

    if (!hasPendingImage) {
      editorAssistantImageThumb.removeAttribute("src");
      editorAssistantImageName.textContent = "";
      editorAssistantClearImage.disabled = true;
      return;
    }

    editorAssistantImageThumb.src = pendingChatImage;
    editorAssistantImageName.textContent = fileName || "Attached reference image";
    editorAssistantClearImage.disabled = false;
  }

  function clearPendingChatImage() {
    pendingChatImage = null;

    if (editorAssistantImageInput) {
      editorAssistantImageInput.value = "";
    }

    renderPendingChatImagePreview("");
  }

  function handleAssistantImageSelection(event) {
    const file = event.target?.files?.[0];

    if (!file) {
      clearPendingChatImage();
      return;
    }

    const reader = new FileReader();
    reader.onload = function (loadEvent) {
      const result = loadEvent?.target?.result;
      pendingChatImage = typeof result === "string" ? result : null;
      renderPendingChatImagePreview(file.name);
    };
    reader.onerror = function () {
      pendingChatImage = null;
      renderPendingChatImagePreview("");
      setGenerateStatus("Unable to read the selected image file.");
    };
    reader.readAsDataURL(file);
  }

  function renderEditorAssistantHistory() {
    if (!editorAssistantHistory) {
      return;
    }

    const history = ensureAssistantChatHistory();

    if (!history.length) {
      editorAssistantHistory.innerHTML =
        '<p class="editor-assistant__empty">Ask for board changes like "Add a dodging mechanic" and I will place nodes on the canvas for you.</p>';
      return;
    }

    editorAssistantHistory.innerHTML = history
      .map((message) => {
        const metaLabel = message.role === "user" ? "You" : "Editor Assistant";
        const bubbleRole = message.role === "user" ? "user" : "assistant";

        return `
          <div class="chat-message-row ${bubbleRole}">
            <div class="chat-message-wrap">
              <p class="chat-meta">${metaLabel}</p>
              <div class="chat-bubble whitespace-pre-wrap ${bubbleRole}">${formatAssistantMessage(
                message.content
              )}</div>
            </div>
          </div>
        `;
      })
      .join("");

    editorAssistantHistory.scrollTop = editorAssistantHistory.scrollHeight;
  }

  function appendEditorAssistantMessage(role, content) {
    const normalizedMessage = normalizeAssistantHistoryMessage({ role, content });

    if (!normalizedMessage) {
      return;
    }

    const history = ensureAssistantChatHistory();
    history.push(normalizedMessage);

    if (history.length > EDITOR_ASSISTANT_HISTORY_LIMIT) {
      editorState.chatHistory = history.slice(-EDITOR_ASSISTANT_HISTORY_LIMIT);
    }

    renderEditorAssistantHistory();
    persistBoardState();
  }

  function setEditorAssistantOpen(isOpen) {
    editorState.assistantChatOpen = Boolean(isOpen);

    if (editorAssistantPanel) {
      editorAssistantPanel.classList.toggle("hidden", !editorState.assistantChatOpen);
    }

    if (editorAssistantFab) {
      editorAssistantFab.setAttribute("aria-expanded", String(editorState.assistantChatOpen));
      editorAssistantFab.setAttribute(
        "aria-label",
        editorState.assistantChatOpen ? "Close editor assistant" : "Open editor assistant"
      );
    }

    if (editorState.assistantChatOpen) {
      renderEditorAssistantHistory();

      if (editorAssistantInput && !editorState.assistantChatPending) {
        window.requestAnimationFrame(() => {
          editorAssistantInput.focus();
        });
      }
    }
  }

  function toggleEditorAssistant() {
    setEditorAssistantOpen(!editorState.assistantChatOpen);
  }

  function buildEditorAssistantRequestHistory() {
    return editorState.chatHistory
      .map(normalizeAssistantHistoryMessage)
      .filter(Boolean)
      .slice(-EDITOR_ASSISTANT_HISTORY_LIMIT);
  }

  function getStickyNoteSpawnPosition() {
    const { centerX, centerY } = getBoardMetrics();
    const noteWidth = getNodeWidth({ kind: "note" });
    const noteHeight = getNodeHeight({ kind: "note" });
    const offsetX = (Math.random() - 0.5) * 240;
    const offsetY = (Math.random() - 0.5) * 180;

    return {
      x: centerX - noteWidth / 2 + offsetX,
      y: centerY - noteHeight / 2 + offsetY,
    };
  }

  function findAssistantCategoryNode(categoryKey) {
    if (categoryKey === "gameName") {
      return getNodeById("title");
    }

    return editorState.nodes.find((node) => node.id === categoryKey && node.kind === "field") || null;
  }

  function normalizeAssistantNodeSearchLabel(value) {
    return String(value || "").trim().toLowerCase();
  }

  function findNodeByLabel(label) {
    const normalizedLabel = normalizeAssistantNodeSearchLabel(label);

    if (!normalizedLabel) {
      return null;
    }

    return (
      editorState.nodes.find(
        (node) => normalizeAssistantNodeSearchLabel(node.label) === normalizedLabel
      ) || null
    );
  }

  function addAssistantNode(label, categoryKey) {
    const targetNode = findAssistantCategoryNode(categoryKey);

    if (!targetNode) {
      return false;
    }

    const targetWidth = getNodeWidth(targetNode);
    const targetHeight = getNodeHeight(targetNode);
    const noteWidth = getNodeWidth({ kind: "note" });
    const noteHeight = getNodeHeight({ kind: "note" });
    const angle = Math.random() * Math.PI * 2;
    const distance =
      categoryKey === "gameName" ? 168 + Math.random() * 40 : 122 + Math.random() * 34;
    const targetCenterX = targetNode.x + targetWidth / 2;
    const targetCenterY = targetNode.y + targetHeight / 2;
    const nextNode = createNode(label, "Node", {
      x: targetCenterX + Math.cos(angle) * distance - noteWidth / 2,
      y: targetCenterY + Math.sin(angle) * distance - noteHeight / 2,
      colorId: "gold",
    });

    editorState.nodes.push(nextNode);
    editorState.links.push({
      id: createLinkId(targetNode.id, nextNode.id),
      from: targetNode.id,
      to: nextNode.id,
    });
    editorState.selectedNodeId = nextNode.id;
    bringNodeToFront(nextNode.id);
    return true;
  }

  function addAssistantNote(text) {
    const position = getStickyNoteSpawnPosition();
    const nextNode = createNode(text, "Node", {
      x: position.x,
      y: position.y,
      colorId: "gold",
      isNote: true,
    });

    editorState.nodes.push(nextNode);
    editorState.selectedNodeId = nextNode.id;
    bringNodeToFront(nextNode.id);
    return true;
  }

  function getLeafTextChildNodeIds(targetNodeId) {
    if (typeof targetNodeId !== "string" || !targetNodeId) {
      return [];
    }

    const linkCounts = new Map();

    editorState.links.forEach((link) => {
      linkCounts.set(link.from, (linkCounts.get(link.from) || 0) + 1);
      linkCounts.set(link.to, (linkCounts.get(link.to) || 0) + 1);
    });

    return Array.from(
      new Set(
        editorState.links
          .filter((link) => link.from === targetNodeId || link.to === targetNodeId)
          .map((link) => (link.from === targetNodeId ? link.to : link.from))
      )
    ).filter((nodeId) => {
      const node = getNodeById(nodeId);
      return Boolean(
        node &&
          node.kind === "note" &&
          node.isImageAsset !== true &&
          (linkCounts.get(nodeId) || 0) <= 1
      );
    });
  }

  function removeNodesById(nodeIds) {
    const removableNodeIds = new Set(
      Array.isArray(nodeIds)
        ? nodeIds.filter((nodeId) => typeof nodeId === "string" && nodeId)
        : []
    );

    if (!removableNodeIds.size) {
      return false;
    }

    editorState.nodes = editorState.nodes.filter((node) => !removableNodeIds.has(node.id));
    editorState.links = editorState.links.filter(
      (link) => !removableNodeIds.has(link.from) && !removableNodeIds.has(link.to)
    );

    if (editorState.selectedNodeId && removableNodeIds.has(editorState.selectedNodeId)) {
      editorState.selectedNodeId = null;
    }

    if (editorState.draggingNodeId && removableNodeIds.has(editorState.draggingNodeId)) {
      editorState.draggingNodeId = null;
    }

    if (editorState.editingNodeId && removableNodeIds.has(editorState.editingNodeId)) {
      closeEditModal();
    }

    if (editorState.contextMenu?.nodeId && removableNodeIds.has(editorState.contextMenu.nodeId)) {
      hideContextMenu();
    }

    if (editorState.linking?.fromNodeId && removableNodeIds.has(editorState.linking.fromNodeId)) {
      editorState.linking = null;
    }

    return true;
  }

  function addAssistantImageAsset(targetCategory, description, imageData) {
    const targetNode = findAssistantCategoryNode(targetCategory);

    if (!targetNode || typeof imageData !== "string" || !imageData.trim()) {
      return false;
    }

    removeNodesById(getLeafTextChildNodeIds(targetNode.id));

    const targetWidth = getNodeWidth(targetNode);
    const targetHeight = getNodeHeight(targetNode);
    const assetWidth = getNodeWidth({ kind: "note", isImageAsset: true });
    const assetHeight = getNodeHeight({ kind: "note", isImageAsset: true });
    const angle = Math.random() * Math.PI * 2;
    const distance = targetCategory === "gameName" ? 210 + Math.random() * 32 : 162 + Math.random() * 32;
    const targetCenterX = targetNode.x + targetWidth / 2;
    const targetCenterY = targetNode.y + targetHeight / 2;
    const nextNode = createNode(description || "Image reference", "Node", {
      x: targetCenterX + Math.cos(angle) * distance - assetWidth / 2,
      y: targetCenterY + Math.sin(angle) * distance - assetHeight / 2,
      colorId: "sky",
      isNote: false,
      isImageAsset: true,
      imageData,
      targetCategory,
    });

    editorState.nodes.push(nextNode);
    editorState.links.push({
      id: createLinkId(targetNode.id, nextNode.id),
      from: targetNode.id,
      to: nextNode.id,
    });
    editorState.selectedNodeId = nextNode.id;
    bringNodeToFront(nextNode.id);
    return true;
  }

  function removeAssistantNode(label) {
    const targetNode = findNodeByLabel(label);

    if (!targetNode) {
      return false;
    }

    return removeNodesById([targetNode.id]);
  }

  function editAssistantNode(targetLabel, newLabel) {
    const targetNode = findNodeByLabel(targetLabel);

    if (!targetNode) {
      return false;
    }

    targetNode.label = normalizeStoredValue(
      newLabel,
      targetNode.kind === "title"
        ? "Untitled Game"
        : targetNode.kind === "field"
          ? "Category"
          : "New note"
    );
    return true;
  }

  function executeEditorAssistantActions(actions, attachedImageData) {
    if (!Array.isArray(actions) || !actions.length) {
      return;
    }

    let didChangeBoard = false;

    actions.forEach((action) => {
      if (
        action?.type === "ADD_NODE" &&
        typeof action.label === "string" &&
        typeof action.category === "string"
      ) {
        didChangeBoard = addAssistantNode(action.label, action.category) || didChangeBoard;
        return;
      }

      if (action?.type === "REMOVE_NODE" && typeof action.label === "string") {
        didChangeBoard = removeAssistantNode(action.label) || didChangeBoard;
        return;
      }

      if (
        action?.type === "EDIT_NODE" &&
        typeof action.targetLabel === "string" &&
        typeof action.newLabel === "string"
      ) {
        didChangeBoard = editAssistantNode(action.targetLabel, action.newLabel) || didChangeBoard;
        return;
      }

      if (action?.type === "ADD_NOTE" && typeof action.text === "string") {
        didChangeBoard = addAssistantNote(action.text) || didChangeBoard;
        return;
      }

      if (
        action?.type === "ADD_IMAGE_ASSET" &&
        typeof action.targetCategory === "string" &&
        typeof action.description === "string"
      ) {
        didChangeBoard =
          addAssistantImageAsset(action.targetCategory, action.description, attachedImageData) ||
          didChangeBoard;
      }
    });

    if (didChangeBoard) {
      persistBoardState();
      scheduleRender();
    }
  }

  async function handleEditorAssistantSubmit(event) {
    event.preventDefault();

    if (editorState.assistantChatPending || !editorAssistantInput) {
      return;
    }

    const message = editorAssistantInput.value.trim();

    if (!message) {
      return;
    }

    const messageHistory = buildEditorAssistantRequestHistory();
    const currentGameConfig = buildGenerationPayload().gameConfig;
    const chatboxGameConfig = {
      ...currentGameConfig,
      imageAssets: Array.isArray(currentGameConfig.imageAssets)
        ? currentGameConfig.imageAssets.map((asset) => ({
            targetCategory: asset.targetCategory,
            description: asset.description,
          }))
        : [],
    };
    const attachedImageData = pendingChatImage;
    const requestMessage = attachedImageData
      ? `${message}\n\n[User attached an image reference]`
      : message;
    clearPendingChatImage();
    editorAssistantInput.value = "";
    setEditorAssistantOpen(true);
    appendEditorAssistantMessage("user", message);
    setEditorAssistantPending(true);

    try {
      const response = await fetch("/editor-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: requestMessage,
          messageHistory,
          gameConfig: chatboxGameConfig,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(getPrototypeErrorMessage(errorText, response.status));
      }

      const payload = await response.json();
      const reply =
        typeof payload?.reply === "string" && payload.reply.trim()
          ? payload.reply.trim()
          : "I am ready to help shape the board.";

      appendEditorAssistantMessage("assistant", reply);
      executeEditorAssistantActions(
        Array.isArray(payload?.actions) ? payload.actions : [],
        attachedImageData
      );
    } catch (error) {
      console.error("Editor assistant request failed:", error);
      appendEditorAssistantMessage(
        "assistant",
        error instanceof Error && error.message
          ? `I hit a problem while updating the board: ${error.message}`
          : "I hit a problem while updating the board. Please try again."
      );
    } finally {
      setEditorAssistantPending(false);

      if (editorAssistantInput) {
        window.requestAnimationFrame(() => {
          editorAssistantInput.focus();
        });
      }
    }
  }

  function updateMetadata(config) {
    const safeName = normalizeStoredValue(config.gameName, "Untitled Game");
    const safeGenre = normalizeStoredValue(config.genre, "Not defined yet");

    document.title = `${safeName} | PlayWeaver Editor`;

    if (summaryName) {
      summaryName.textContent = safeName;
    }

    if (summaryGenre) {
      summaryGenre.textContent = safeGenre === "None" ? "Not defined yet" : safeGenre;
    }
  }

  function buildAdjacencyMap() {
    const adjacency = new Map();

    editorState.nodes.forEach((node) => adjacency.set(node.id, new Set()));

    editorState.links.forEach((link) => {
      if (adjacency.has(link.from) && adjacency.has(link.to)) {
        adjacency.get(link.from).add(link.to);
        adjacency.get(link.to).add(link.from);
      }
    });

    return adjacency;
  }

  function buildReachableBoardState() {
    const adjacency = buildAdjacencyMap();
    const reachableNodeIds = new Set();
    const queue = [];

    ROOT_NODE_IDS.forEach((rootNodeId) => {
      if (adjacency.has(rootNodeId)) {
        reachableNodeIds.add(rootNodeId);
        queue.push(rootNodeId);
      }
    });

    while (queue.length) {
      const currentNodeId = queue.shift();
      const neighbors = adjacency.get(currentNodeId) || [];

      neighbors.forEach((neighborId) => {
        if (!reachableNodeIds.has(neighborId)) {
          reachableNodeIds.add(neighborId);
          queue.push(neighborId);
        }
      });
    }

    return {
      adjacency,
      reachableNodeIds,
      nodes: editorState.nodes.filter((node) => reachableNodeIds.has(node.id)),
      links: editorState.links.filter(
        (link) => reachableNodeIds.has(link.from) && reachableNodeIds.has(link.to)
      ),
    };
  }

  function collectFieldValues(fieldId, adjacency, reachableNodeIds) {
    const visited = new Set([fieldId]);
    const queue = [...(adjacency.get(fieldId) || [])].filter((nodeId) => reachableNodeIds.has(nodeId));
    const collected = [];

    while (queue.length) {
      const currentNodeId = queue.shift();

      if (visited.has(currentNodeId) || !reachableNodeIds.has(currentNodeId)) {
        continue;
      }

      visited.add(currentNodeId);

      if (FIELD_IDS.has(currentNodeId) || currentNodeId === "title") {
        continue;
      }

      const node = getNodeById(currentNodeId);

      if (!node || node.kind !== "note") {
        continue;
      }

      const normalizedLabel = normalizeStoredValue(node.label, "");

      if (normalizedLabel && normalizedLabel.toLowerCase() !== "none") {
        collected.push(normalizedLabel);
      }

      const neighbors = adjacency.get(currentNodeId) || [];
      neighbors.forEach((neighborId) => {
        if (
          !visited.has(neighborId) &&
          reachableNodeIds.has(neighborId) &&
          !FIELD_IDS.has(neighborId) &&
          neighborId !== "title"
        ) {
          queue.push(neighborId);
        }
      });
    }

    return Array.from(new Set(collected));
  }

  function buildGenerationPayload() {
    const { adjacency, reachableNodeIds, nodes, links } = buildReachableBoardState();
    const gameConfig = getDefaultGameConfig();
    const titleNode = getNodeById("title");

    gameConfig.gameName = normalizeStoredValue(titleNode?.label, "Untitled Game");

    BASE_FIELDS.forEach((field) => {
      const values = collectFieldValues(field.key, adjacency, reachableNodeIds);
      gameConfig[field.key] = values.length ? values.join(", ") : "None";
    });

    gameConfig.developerNotes = editorState.nodes
      .filter((node) => node.isNote === true)
      .map((node) => normalizeStoredValue(node.label, ""))
      .filter(Boolean);

    gameConfig.imageAssets = editorState.nodes
      .filter((node) => node.isImageAsset === true && typeof node.imageData === "string" && node.imageData)
      .map((node) => ({
        targetCategory:
          typeof node.targetCategory === "string" && node.targetCategory.trim()
            ? node.targetCategory.trim()
            : "gameName",
        description: normalizeStoredValue(node.label, "Reference image"),
        imageData: node.imageData,
      }));

    return {
      gameConfig: normalizeGameConfig(gameConfig),
      boardState: {
        nodes: nodes.map((node) => ({
          id: node.id,
          kind: node.kind,
          label: normalizeStoredValue(
            node.label,
            node.kind === "title" ? "Untitled Game" : node.kind === "field" ? "Field" : "New note"
          ),
          x: node.x,
          y: node.y,
          locked: Boolean(node.locked),
          isNote: Boolean(node.isNote),
          isImageAsset: Boolean(node.isImageAsset),
          imageData: typeof node.imageData === "string" ? node.imageData : "",
          targetCategory: typeof node.targetCategory === "string" ? node.targetCategory : "",
          colorId: node.colorId,
        })),
        links: links.map((link) => ({
          id: link.id,
          from: link.from,
          to: link.to,
        })),
      },
    };
  }

  function buildPersistedBoardState(gameConfig) {
    return {
      version: EDITOR_STATE_VERSION,
      nodes: editorState.nodes,
      links: editorState.links,
      pan: editorState.pan,
      zoom: editorState.zoom,
      signature: createConfigSignature(gameConfig),
      html: getCurrentGeneratedHtml(),
      chatHistory: normalizeAssistantHistory(editorState.chatHistory),
    };
  }

  function writeProjectStateToLocalStorage(boardState, gameConfig) {
    try {
      localStorage.setItem(EDITOR_STATE_KEY, JSON.stringify(boardState));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(gameConfig));
    } catch (error) {
      console.error("Failed to persist editor state:", error);
    }
  }

  function scheduleCloudSync() {
    if (cloudSyncTimeoutId) {
      window.clearTimeout(cloudSyncTimeoutId);
    }

    cloudSyncTimeoutId = window.setTimeout(() => {
      syncStateToCloud().catch((error) => {
        console.error("Failed to sync project state to cloud:", error);
      });
    }, CLOUD_SYNC_DEBOUNCE_MS);
  }

  function persistBoardState() {
    const payload = buildGenerationPayload();
    writeProjectStateToLocalStorage(buildPersistedBoardState(payload.gameConfig), payload.gameConfig);
    scheduleCloudSync();
  }

  function updateCounts() {
    if (nodeCount) {
      nodeCount.textContent = String(editorState.nodes.length);
    }

    if (linkCount) {
      linkCount.textContent = String(editorState.links.length);
    }
  }

  function updateOpenInNewTabState() {
    if (openTabBtn) {
      openTabBtn.disabled = !editorState.currentGeneratedHtml;
    }
  }

  function setLoadingOverlay(isVisible, isRegenerating) {
    if (!gameLoadingOverlay || !gameLoadingText) {
      return;
    }

    gameLoadingText.textContent = isRegenerating ? "Regenerating..." : "Generating...";
    gameLoadingOverlay.classList.toggle("is-visible", isVisible);
    gameLoadingOverlay.setAttribute("aria-hidden", String(!isVisible));
  }

  function clearPrototypeUrl() {
    if (!editorState.currentPrototypeUrl) {
      return;
    }

    URL.revokeObjectURL(editorState.currentPrototypeUrl);
    editorState.currentPrototypeUrl = null;
  }

  function getStateIdFromUrl() {
    const stateId = new URL(window.location.href).searchParams.get("id");
    return typeof stateId === "string" ? stateId.trim() : "";
  }

  function setStateIdInUrl(stateId) {
    const url = new URL(window.location.href);
    url.searchParams.set("id", stateId);
    window.history.replaceState({ stateId }, "", url);
  }

  function ensureStateIdInUrl() {
    const existingId = getStateIdFromUrl();

    if (existingId) {
      return existingId;
    }

    const nextId = crypto.randomUUID();
    setStateIdInUrl(nextId);
    return nextId;
  }

  function forkStateIdInUrl() {
    const nextId = crypto.randomUUID();
    setStateIdInUrl(nextId);
    return nextId;
  }

  function sanitizeDownloadName(value) {
    const safeName = normalizeStoredValue(value, "playweaver-game")
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return safeName || "playweaver-game";
  }

  function sanitizeHtmlForGeneration(html) {
    if (typeof html !== "string" || !html) {
      return "";
    }

    return html.replace(BASE64_IMAGE_PATTERN, "GAME_ASSETS.placeholder");
  }

  function buildGameAssetMap() {
    return editorState.nodes.reduce((assetMap, node) => {
      if (
        node?.isImageAsset === true &&
        typeof node.targetCategory === "string" &&
        node.targetCategory.trim() &&
        typeof node.imageData === "string" &&
        node.imageData.trim()
      ) {
        assetMap[node.targetCategory.trim()] = node.imageData.trim();
      }

      return assetMap;
    }, {});
  }

  function buildGameAssetsBootstrapHtml() {
    const serializedAssetMap = JSON.stringify(buildGameAssetMap());
    const serializedPlaceholder = JSON.stringify(GAME_ASSET_PLACEHOLDER_SRC);

    return `<script>
window.GAME_ASSETS = (function () {
  const assetMap = ${serializedAssetMap};
  const assets = {};

  Object.entries(assetMap).forEach(([key, imageData]) => {
    if (typeof imageData !== "string" || !imageData) {
      return;
    }

    const image = new Image();
    image.src = imageData;
    assets[key] = image;
  });

  const placeholder = new Image();
  placeholder.src = ${serializedPlaceholder};
  assets.placeholder = placeholder;

  return assets;
})();
</script>`;
  }

  function injectGameAssetsIntoHtml(html) {
    const sourceHtml = typeof html === "string" ? html : "";

    if (!sourceHtml.trim()) {
      return "";
    }

    const bootstrapHtml = buildGameAssetsBootstrapHtml();
    const doctypeMatch = sourceHtml.match(/^\s*<!doctype[^>]*>/i);

    if (!doctypeMatch) {
      return `${bootstrapHtml}\n${sourceHtml}`;
    }

    const doctype = doctypeMatch[0];
    return `${doctype}\n${bootstrapHtml}\n${sourceHtml.slice(doctype.length)}`;
  }

  function setCurrentGeneratedHtml(html) {
    editorState.currentGeneratedHtml = typeof html === "string" ? html : "";
    clearPrototypeUrl();
    const renderedHtml = injectGameAssetsIntoHtml(editorState.currentGeneratedHtml);

    if (gameFrame) {
      gameFrame.removeAttribute("src");
      gameFrame.srcdoc = "";
      gameFrame.setAttribute("srcdoc", renderedHtml);
      gameFrame.srcdoc = renderedHtml;
    }

    updateOpenInNewTabState();
  }

  function getCurrentGeneratedHtml() {
    return typeof editorState.currentGeneratedHtml === "string" ? editorState.currentGeneratedHtml : "";
  }

  function getRenderedGeneratedHtml() {
    return injectGameAssetsIntoHtml(getCurrentGeneratedHtml());
  }

  function getSessionToken() {
    return localStorage.getItem("playweaverToken") || "";
  }

  async function postStateToCloud(stateId, payload) {
    return fetch("/state", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: stateId,
        html: getCurrentGeneratedHtml(),
        editorState: buildPersistedBoardState(payload.gameConfig),
        gameConfig: payload.gameConfig,
        token: getSessionToken(),
      }),
    });
  }

  async function syncStateToCloud() {
    if (cloudSyncTimeoutId) {
      window.clearTimeout(cloudSyncTimeoutId);
      cloudSyncTimeoutId = null;
    }

    const payload = buildGenerationPayload();
    let stateId = ensureStateIdInUrl();
    let response = await postStateToCloud(stateId, payload);

    if (response.status === 409) {
      const conflictBody = await response.text();
      let parsedConflict = null;

      try {
        parsedConflict = JSON.parse(conflictBody);
      } catch (error) {
        console.error("Failed to parse cloud sync conflict payload:", error);
      }

      if (parsedConflict?.forkRequired) {
        stateId = forkStateIdInUrl();
        response = await postStateToCloud(stateId, payload);

        if (response.ok) {
          setGenerateStatus(
            "This project belonged to another account, so PlayWeaver forked your changes into a new project link."
          );
          return stateId;
        }
      } else {
        throw new Error(getPrototypeErrorMessage(conflictBody, response.status));
      }
    }

    if (!response.ok) {
      const errorText = await response.text();

      if (response.status === 401) {
        localStorage.removeItem("playweaverToken");
        localStorage.removeItem("playweaverUser");
      }

      throw new Error(getPrototypeErrorMessage(errorText, response.status));
    }

    return stateId;
  }

  function applyCloudProjectState(projectState) {
    const normalizedBoardState = normalizeBoardState(projectState?.editorState);
    const normalizedGameConfig =
      projectState?.gameConfig && typeof projectState.gameConfig === "object"
        ? normalizeGameConfig(projectState.gameConfig)
        : getDefaultGameConfig();
    editorState.chatHistory = normalizeAssistantHistory(normalizedBoardState?.chatHistory || []);

    if (normalizedBoardState) {
      editorState.nodes = normalizedBoardState.nodes;
      editorState.links = normalizedBoardState.links;
      editorState.pan = normalizedBoardState.pan;
      editorState.zoom = normalizedBoardState.zoom || 1;
      editorState.nodeIdCounter = normalizedBoardState.nodes.length;
      editorState.selectedNodeId = null;
      editorState.draggingNodeId = null;
      editorState.panning = null;
      editorState.linking = null;
      editorState.contextMenu = null;
      editorState.editingNodeId = null;
    }

    setCurrentGeneratedHtml(
      typeof projectState?.html === "string" ? projectState.html : normalizedBoardState?.html || ""
    );
    writeProjectStateToLocalStorage(buildPersistedBoardState(normalizedGameConfig), normalizedGameConfig);
    updateMetadata(normalizedGameConfig);
    renderEditorAssistantHistory();
    scheduleRender();
  }

  async function loadPrototypeStateFromUrl() {
    const stateId = getStateIdFromUrl();

    if (!stateId) {
      return;
    }

    try {
      setGenerateStatus("Loading saved project...");
      const response = await fetch(`/state?id=${encodeURIComponent(stateId)}`, {
        headers: {
          Accept: "application/json",
        },
      });

      if (response.status === 404) {
        setGenerateStatus(READY_STATUS);
        return;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(getPrototypeErrorMessage(errorText, response.status));
      }

      const payload = await response.json();

      if (!payload || typeof payload !== "object") {
        setGenerateStatus(READY_STATUS);
        return;
      }

      applyCloudProjectState(payload);
      setGenerateStatus("Loaded saved project from this URL.");
    } catch (error) {
      console.error("Failed to load saved project:", error);
      setGenerateStatus(
        error instanceof Error && error.message
          ? `Saved project load failed: ${error.message}`
          : "Unable to load the saved project from this URL."
      );
    }
  }

  function setPreviewMaximized(isMaximized) {
    if (!previewCard || !previewBackdrop || !previewSizeToggleBtn) {
      return;
    }

    previewCard.classList.toggle("is-maximized", isMaximized);
    previewBackdrop.classList.toggle("is-visible", isMaximized);
    previewBackdrop.setAttribute("aria-hidden", String(!isMaximized));
    previewSizeToggleBtn.setAttribute("aria-pressed", String(isMaximized));
    previewSizeToggleBtn.setAttribute(
      "aria-label",
      isMaximized ? "Minimize live preview" : "Maximize live preview"
    );

    if (previewSizeToggleIcon) {
      previewSizeToggleIcon.textContent = isMaximized ? "x" : "[]";
    }
  }

  function togglePreviewMaximized() {
    if (!previewCard) {
      return;
    }

    setPreviewMaximized(!previewCard.classList.contains("is-maximized"));
  }

  async function downloadGeneratedPrototypeZip() {
    const renderedHtml = getRenderedGeneratedHtml();

    if (!renderedHtml) {
      setGenerateStatus("Generate or load a prototype before downloading.");
      return;
    }

    if (!window.JSZip) {
      setGenerateStatus("JSZip is not available right now.");
      return;
    }

    try {
      const zip = new window.JSZip();
      const gameName = buildGenerationPayload().gameConfig.gameName;
      const fileBaseName = sanitizeDownloadName(gameName);
      const downloadUrl = URL.createObjectURL(
        await zip.file("index.html", renderedHtml).generateAsync({
          type: "blob",
        })
      );
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${fileBaseName}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setGenerateStatus("Downloaded the current prototype as a .zip.");
    } catch (error) {
      console.error("Failed to download prototype zip:", error);
      setGenerateStatus(
        error instanceof Error && error.message
          ? `Zip download failed: ${error.message}`
          : "Unable to create the .zip download right now."
      );
    }
  }

  function focusEditableNodeLabel(event) {
    const nodeId = event.currentTarget.closest(".board-node")?.dataset?.nodeId;

    if (nodeId) {
      editorState.selectedNodeId = nodeId;
    }
  }

  function handleEditableLabelPointerDown(event) {
    focusEditableNodeLabel(event);
    event.stopPropagation();
  }

  function handleEditableLabelMouseDown(event) {
    focusEditableNodeLabel(event);
    event.stopPropagation();
  }

  function renderNodes() {
    boardNodes.innerHTML = editorState.nodes
      .map((node, index) => {
        const color = node.isNote
          ? getColorToken("gold", node.kind)
          : node.isImageAsset
            ? getColorToken("sky", node.kind)
            : getColorToken(node.colorId, node.kind);
        const position = nodeToScreenPosition(node);
        const selected = node.id === editorState.selectedNodeId;
        const classes = [
          "board-node",
          `board-node--${node.kind}`,
          node.isNote ? "board-node--sticky-note" : "",
          node.isImageAsset ? "board-node--image-asset" : "",
          selected ? "is-selected" : "",
          node.locked ? "is-locked" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const kindLabel =
          node.isNote
            ? "Developer Note"
            : node.isImageAsset
              ? "Image Asset"
            : node.kind === "title"
              ? "Game Title"
              : node.kind === "field"
                ? "Category"
                : "Node";
        const labelAttributes = 'data-editable="false"';
        const imageMarkup =
          node.isImageAsset && node.imageData
            ? `<img src="${escapeHtml(
                node.imageData
              )}" alt="${escapeHtml(
                node.label
              )}" style="display:block; width:100%; height:7rem; object-fit:cover; border-radius:0.95rem; margin-bottom:0.75rem; border:1px solid rgba(255,255,255,0.14);" />`
            : "";
        const extraStyle = node.isImageAsset
          ? `width:${getNodeWidth(node)}px; max-width:${getNodeWidth(node)}px; min-height:${getNodeHeight(
              node
            )}px;`
          : "";

        return `
          <article
            class="${classes}"
            data-node-id="${escapeHtml(node.id)}"
            style="
              left:${position.x}px;
              top:${position.y}px;
              z-index:${index + 1};
              --node-surface:${color.surface};
              --node-border:${color.border};
              --node-glow:${color.glow};
              --node-ink:${color.ink};
              ${extraStyle}
            "
          >
            <span class="board-node__kind">${kindLabel}</span>
            ${imageMarkup}
            <div class="board-node__label" ${labelAttributes} spellcheck="false">${escapeHtml(
              node.label
            )}</div>
          </article>
        `;
      })
      .join("");

  }

  function buildLinkPath(start, end) {
    const direction = start.x <= end.x ? 1 : -1;
    const curve = Math.max(70, Math.abs(end.x - start.x) * 0.45);
    const controlOneX = start.x + curve * direction;
    const controlTwoX = end.x - curve * direction;

    return `M ${start.x} ${start.y} C ${controlOneX} ${start.y}, ${controlTwoX} ${end.y}, ${end.x} ${end.y}`;
  }

  function handleLinkPathContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();

    const linkId = event.currentTarget?.dataset?.linkId;

    if (!linkId) {
      return;
    }

    cancelLinkMode();
    showContextMenu(event.clientX, event.clientY, {
      kind: "link",
      linkId,
    });
  }

  function renderLinks() {
    const width = boardCanvas.clientWidth || window.innerWidth;
    const height = boardCanvas.clientHeight || window.innerHeight;
    const paths = [];

    boardLinks.setAttribute("viewBox", `0 0 ${width} ${height}`);
    boardLinks.setAttribute("width", String(width));
    boardLinks.setAttribute("height", String(height));

    editorState.links.forEach((link) => {
      const from = getNodeCenter(link.from);
      const to = getNodeCenter(link.to);

      if (!from || !to) {
        return;
      }

      paths.push(
        `
          <g class="board-link-group" data-link-id="${escapeHtml(link.id)}">
            <path class="board-link-hitarea" data-link-id="${escapeHtml(link.id)}" d="${buildLinkPath(
              from,
              to
            )}"></path>
            <path class="board-link" d="${buildLinkPath(from, to)}"></path>
          </g>
        `
      );
    });

    if (editorState.linking) {
      const start = getNodeCenter(editorState.linking.fromNodeId);
      const end = editorState.linking.pointer;

      if (start && end) {
        paths.push(
          `<path class="board-link board-link--preview" d="${buildLinkPath(start, end)}"></path>`
        );
      }
    }

    boardLinks.innerHTML = paths.join("");
    boardLinks.querySelectorAll(".board-link-hitarea[data-link-id]").forEach((pathElement) => {
      pathElement.addEventListener("contextmenu", handleLinkPathContextMenu);
    });
  }

  function positionFloatingElement(element, x, y) {
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;

    window.requestAnimationFrame(() => {
      const rect = element.getBoundingClientRect();
      const nextLeft = clamp(x, 12, window.innerWidth - rect.width - 12);
      const nextTop = clamp(y, 12, window.innerHeight - rect.height - 12);

      element.style.left = `${nextLeft}px`;
      element.style.top = `${nextTop}px`;
    });
  }

  function renderContextButton(action, symbol, label, options) {
    const buttonOptions = options || {};
    const classes = ["context-menu__button"];

    if (buttonOptions.danger) {
      classes.push("context-menu__button--danger");
    }

    return `
      <button
        type="button"
        class="${classes.join(" ")}"
        data-menu-action="${escapeHtml(action)}"
        ${buttonOptions.disabled ? 'disabled aria-disabled="true"' : ""}
      >
        <span class="context-menu__symbol">${escapeHtml(symbol)}</span>
        <span>${escapeHtml(label)}</span>
      </button>
    `;
  }

  function canDeleteNode(node) {
    return Boolean(node && node.kind === "note" && !node.locked);
  }

  function canEditNode(node) {
    return Boolean(node && (node.kind === "note" || node.kind === "title"));
  }

  function renderContextMenu(context) {
    if (!context) {
      return "";
    }

    if (context.kind === "canvas") {
      return renderContextButton("add-node", "+", "Add Node");
    }

    if (context.kind === "link") {
      return renderContextButton("delete-link", "-", "Delete Link", { danger: true });
    }

    if (context.kind === "node") {
      const node = getNodeById(context.nodeId);

      if (!node) {
        return "";
      }

      const canEdit = canEditNode(node);
      const canLinkFromNode = canStartManualLink(node.id);

      return `
        ${renderContextButton("edit-node", "E", "Edit", {
          disabled: !canEdit,
        })}
        ${renderContextButton("start-link", "->", "Start Link", {
          disabled: !canLinkFromNode,
        })}
        <div class="context-menu__section">
          <p class="context-menu__section-label">Change Color</p>
          <div class="context-menu__swatches">
            ${NODE_COLORS.map((preset) => {
              const isActive = preset.id === node.colorId ? "is-active" : "";
              return `
                <button
                  type="button"
                  class="context-menu__swatch ${isActive}"
                  data-color-id="${preset.id}"
                  aria-label="Apply ${preset.id} color"
                  style="background:${preset.surface}; border-color:${preset.border};"
                ></button>
              `;
            }).join("")}
          </div>
        </div>
        ${renderContextButton("delete-node", "-", "Delete Node", {
          danger: true,
          disabled: !canDeleteNode(node),
        })}
      `;
    }

    return "";
  }

  function hideContextMenu() {
    editorState.contextMenu = null;
    canvasContextMenu.innerHTML = "";
    canvasContextMenu.classList.add("hidden");
  }

  function showContextMenu(x, y, context) {
    editorState.contextMenu = context;
    canvasContextMenu.innerHTML = renderContextMenu(context);
    canvasContextMenu.classList.remove("hidden");
    positionFloatingElement(canvasContextMenu, x, y);
  }

  function renderLinkHint() {
    if (!linkHint) {
      return;
    }

    linkHint.classList.toggle("hidden", !editorState.linking);
  }

  function renderDebugPanel(payload) {
    if (!debugPanel || !debugPayload) {
      return;
    }

    debugPanel.classList.toggle("hidden", !editorState.debugVisible);
    debugPayload.textContent = JSON.stringify(payload, null, 2);
  }

  function renderEditor() {
    const payload = buildGenerationPayload();
    const { width, height, centerX, centerY } = getBoardMetrics();
    const gridSize = GRID_SIZE * editorState.zoom;
    const gridOffsetX = positiveModulo(
      editorState.pan.x * editorState.zoom + centerX * (1 - editorState.zoom),
      gridSize
    );
    const gridOffsetY = positiveModulo(
      editorState.pan.y * editorState.zoom + centerY * (1 - editorState.zoom),
      gridSize
    );

    updateMetadata(payload.gameConfig);
    updateCounts();
    updateOpenInNewTabState();

    boardCanvas.style.setProperty("--grid-size", `${gridSize}px`);
    boardCanvas.style.setProperty("--grid-offset-x", `${gridOffsetX}px`);
    boardCanvas.style.setProperty("--grid-offset-y", `${gridOffsetY}px`);
    boardCanvas.classList.toggle("is-panning", Boolean(editorState.panning));
    boardCanvas.classList.toggle("is-linking", Boolean(editorState.linking));
    boardStage.style.width = `${width}px`;
    boardStage.style.height = `${height}px`;
    boardStage.style.transform = `scale(${editorState.zoom}) translate(${editorState.pan.x}px, ${editorState.pan.y}px)`;

    renderNodes();
    renderLinks();
    renderLinkHint();
    renderDebugPanel(payload);
  }

  function scheduleRender() {
    if (editorState.renderQueued) {
      return;
    }

    editorState.renderQueued = true;

    window.requestAnimationFrame(() => {
      editorState.renderQueued = false;
      renderEditor();
    });
  }

  function bringNodeToFront(nodeId) {
    const index = getNodeIndex(nodeId);

    if (index < 0 || index === editorState.nodes.length - 1) {
      return;
    }

    const movedNode = editorState.nodes.splice(index, 1)[0];
    editorState.nodes.push(movedNode);
  }

  function hasLinkBetween(nodeA, nodeB) {
    return editorState.links.some(
      (link) =>
        (link.from === nodeA && link.to === nodeB) || (link.from === nodeB && link.to === nodeA)
    );
  }

  function addNodeAtWorld(worldX, worldY) {
    const nextNode = createNode("New note", "Node", {
      x: worldX,
      y: worldY,
      colorId: "gold",
    });

    editorState.nodes.push(nextNode);
    editorState.selectedNodeId = nextNode.id;
    persistBoardState();
    scheduleRender();
  }

  function deleteLink(linkId) {
    const hadLink = editorState.links.some((link) => link.id === linkId);

    if (!hadLink) {
      return;
    }

    editorState.links = editorState.links.filter((link) => link.id !== linkId);
    persistBoardState();
    scheduleRender();
  }

  function removeLinksForNode(nodeId) {
    editorState.links = editorState.links.filter((link) => link.from !== nodeId && link.to !== nodeId);
  }

  function deleteNode(nodeId) {
    const targetNodeId = nodeId || editorState.selectedNodeId;
    const node = getNodeById(targetNodeId);

    if (!canDeleteNode(node)) {
      return;
    }

    editorState.nodes = editorState.nodes.filter((item) => item.id !== targetNodeId);
    removeLinksForNode(targetNodeId);

    if (editorState.linking?.fromNodeId === targetNodeId) {
      editorState.linking = null;
    }

    editorState.selectedNodeId = null;
    persistBoardState();
    scheduleRender();
  }

  function closeEditModal() {
    editorState.editingNodeId = null;

    if (editNodeModal) {
      editNodeModal.classList.add("hidden");
    }
  }

  function openEditModal(nodeId) {
    const node = getNodeById(nodeId);

    if (!canEditNode(node) || !editNodeModal || !editNodeInput) {
      return;
    }

    editorState.editingNodeId = nodeId;
    editNodeInput.value = node.label;
    editNodeModal.classList.remove("hidden");
    hideContextMenu();

    window.requestAnimationFrame(() => {
      editNodeInput.focus();
      editNodeInput.select();
    });
  }

  function saveEditedNodeLabel() {
    const node = getNodeById(editorState.editingNodeId);

    if (!canEditNode(node) || !editNodeInput) {
      closeEditModal();
      return;
    }

    node.label = normalizeStoredValue(
      editNodeInput.value,
      node.kind === "title" ? "Untitled Game" : "New note"
    );

    persistBoardState();
    scheduleRender();
    closeEditModal();
  }

  function startLinkMode(fromNodeId) {
    if (!canStartManualLink(fromNodeId)) {
      return;
    }

    editorState.linking = {
      fromNodeId,
      pointer: getNodeCenter(fromNodeId),
    };
    editorState.selectedNodeId = fromNodeId;
    hideContextMenu();
    scheduleRender();
  }

  function cancelLinkMode() {
    if (!editorState.linking) {
      return;
    }

    editorState.linking = null;
    scheduleRender();
  }

  function completeLink(targetNodeId) {
    if (!editorState.linking) {
      return;
    }

    const fromNodeId = editorState.linking.fromNodeId;

    if (fromNodeId === targetNodeId) {
      cancelLinkMode();
      return;
    }

    if (!canCreateManualLink(fromNodeId, targetNodeId)) {
      cancelLinkMode();
      return;
    }

    if (!hasLinkBetween(fromNodeId, targetNodeId)) {
      editorState.links.push({
        id: createLinkId(fromNodeId, targetNodeId),
        from: fromNodeId,
        to: targetNodeId,
      });
      persistBoardState();
    }

    editorState.linking = null;
    editorState.selectedNodeId = targetNodeId;
    scheduleRender();
  }

  function syncEditableLabel(labelElement, options) {
    const syncOptions = options || {};
    const nodeElement = labelElement.closest(".board-node");
    const nodeId = nodeElement?.dataset?.nodeId;
    const node = getNodeById(nodeId);

    if (!node || node.kind !== "note") {
      return;
    }

    if (syncOptions.commit) {
      node.label = normalizeStoredValue(normalizeEditableText(labelElement.textContent), "New note");
      labelElement.textContent = node.label;
      persistBoardState();
    } else {
      node.label = String(labelElement.textContent || "");
    }

    updateMetadata(buildGenerationPayload().gameConfig);
  }

  function openPrototypeInNewTab() {
    const renderedHtml = getRenderedGeneratedHtml();

    if (!renderedHtml) {
      setGenerateStatus("Generate a prototype before opening a new tab.");
      return;
    }

    clearPrototypeUrl();

    const htmlBlob = new Blob([renderedHtml], { type: "text/html" });
    const prototypeUrl = URL.createObjectURL(htmlBlob);
    editorState.currentPrototypeUrl = prototypeUrl;
    const openedWindow = window.open(prototypeUrl, "_blank", "noopener,noreferrer");

    if (!openedWindow) {
      setGenerateStatus("The new tab was blocked. Please allow popups and try again.");
      clearPrototypeUrl();
      return;
    }

    window.setTimeout(() => {
      if (editorState.currentPrototypeUrl === prototypeUrl) {
        clearPrototypeUrl();
      } else {
        URL.revokeObjectURL(prototypeUrl);
      }
    }, 60000);
  }

  function getPrototypeErrorMessage(responseBody, status) {
    if (!responseBody) {
      return `Prototype request failed with status ${status}.`;
    }

    try {
      const parsedBody = JSON.parse(responseBody);

      if (typeof parsedBody?.error === "string" && parsedBody.error.trim()) {
        return parsedBody.error.trim();
      }
    } catch (error) {
      console.error("Failed to parse prototype error payload:", error);
    }

    return responseBody;
  }

  function isAutoRemovableStickyNote(node) {
    return Boolean(node && node.isNote === true && node.isImageAsset !== true);
  }

  function clearDeveloperNotesAfterGeneration() {
    const noteIds = new Set(
      editorState.nodes.filter((node) => isAutoRemovableStickyNote(node)).map((node) => node.id)
    );

    if (!noteIds.size) {
      return;
    }

    editorState.nodes = editorState.nodes.filter((node) => !noteIds.has(node.id));
    editorState.links = editorState.links.filter(
      (link) => !noteIds.has(link.from) && !noteIds.has(link.to)
    );

    if (editorState.selectedNodeId && noteIds.has(editorState.selectedNodeId)) {
      editorState.selectedNodeId = null;
    }

    if (editorState.draggingNodeId && noteIds.has(editorState.draggingNodeId)) {
      editorState.draggingNodeId = null;
    }

    if (editorState.linking?.fromNodeId && noteIds.has(editorState.linking.fromNodeId)) {
      editorState.linking = null;
    }

    persistBoardState();
    scheduleRender();
  }

  async function handleGeneratePrototype() {
    const payload = buildGenerationPayload();
    const currentHtml = getCurrentGeneratedHtml();
    const sanitizedCurrentHtml = sanitizeHtmlForGeneration(currentHtml);
    const isRegenerating = Boolean(currentHtml);

    persistBoardState();
    updateMetadata(payload.gameConfig);

    if (generateBtn) {
      generateBtn.disabled = true;
    }

    if (openTabBtn) {
      openTabBtn.disabled = true;
    }

    setLoadingOverlay(true, isRegenerating);
    setGenerateStatus(
      isRegenerating
        ? "Regenerating prototype from linked nodes..."
        : "Generating prototype from linked nodes..."
    );

    try {
      const response = await fetch("/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gameConfig: payload.gameConfig,
          currentHtml: sanitizedCurrentHtml,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(getPrototypeErrorMessage(errorText, response.status));
      }

      const generatedHtml = await response.text();
      setCurrentGeneratedHtml(generatedHtml);
      persistBoardState();
      clearDeveloperNotesAfterGeneration();

      let saveError = null;

      try {
        await syncStateToCloud();
      } catch (error) {
        saveError = error;
        console.error("Failed to sync generated project state:", error);
      }

      setGenerateStatus(
        saveError instanceof Error && saveError.message
          ? `Prototype ready, but cloud sync failed: ${saveError.message}`
          : "Prototype ready. Only linked nodes were sent to generation and the full project was synced."
      );
    } catch (error) {
      console.error("Failed to generate prototype:", error);
      setGenerateStatus(
        error instanceof Error && error.message
          ? `Prototype generation failed: ${error.message}`
          : "Something went wrong while generating the prototype. Please try again."
      );
    } finally {
      if (generateBtn) {
        generateBtn.disabled = false;
      }

      setLoadingOverlay(false, isRegenerating);
      updateOpenInNewTabState();
    }
  }

  function initializeBoard() {
    const initialConfig = loadInitialConfig();
    const storedBoard = loadBoardState(initialConfig);

    editorState.nodes = storedBoard.nodes;
    editorState.links = storedBoard.links;
    editorState.pan = storedBoard.pan;
    editorState.zoom = storedBoard.zoom || 1;
    editorState.nodeIdCounter = editorState.nodes.length;
    editorState.chatHistory = normalizeAssistantHistory(storedBoard.chatHistory || []);
    setCurrentGeneratedHtml(typeof storedBoard.html === "string" ? storedBoard.html : "");

    updateMetadata(buildGenerationPayload().gameConfig);
    setGenerateStatus(READY_STATUS);
    setPreviewMaximized(false);
    setEditorAssistantPending(false);
    renderPendingChatImagePreview("");
    renderEditorAssistantHistory();
    setEditorAssistantOpen(false);
    updateOpenInNewTabState();
    scheduleRender();
  }

  function updateDebugSequence(key) {
    editorState.debugKeyHistory.push(key);

    if (editorState.debugKeyHistory.length > DEBUG_SEQUENCE.length) {
      editorState.debugKeyHistory.shift();
    }

    if (
      editorState.debugKeyHistory.length === DEBUG_SEQUENCE.length &&
      DEBUG_SEQUENCE.every((expectedKey, index) => editorState.debugKeyHistory[index] === expectedKey)
    ) {
      editorState.debugVisible = !editorState.debugVisible;
      editorState.debugKeyHistory = [];
      scheduleRender();
    }
  }

  function handlePointerMove(event) {
    if (editorState.panning) {
      editorState.pan = {
        x:
          editorState.panning.startPan.x +
          (event.clientX - editorState.panning.startClient.x) / editorState.zoom,
        y:
          editorState.panning.startPan.y +
          (event.clientY - editorState.panning.startClient.y) / editorState.zoom,
      };
      scheduleRender();
      return;
    }

    if (editorState.draggingNodeId) {
      const node = getNodeById(editorState.draggingNodeId);

      if (!node) {
        return;
      }

      const pointerWorld = clientToWorld(event.clientX, event.clientY);

      node.x = pointerWorld.x - editorState.dragPointerOffset.x;
      node.y = pointerWorld.y - editorState.dragPointerOffset.y;
      scheduleRender();
      return;
    }

    if (editorState.linking) {
      editorState.linking.pointer = clientToWorld(event.clientX, event.clientY);
      scheduleRender();
    }
  }

  function handlePointerUp() {
    if (editorState.draggingNodeId || editorState.panning) {
      persistBoardState();
    }

    editorState.draggingNodeId = null;
    editorState.panning = null;
    scheduleRender();
  }

  function handleCanvasPointerDown(event) {
    if (event.button !== 0) {
      return;
    }

    if (
      event.target.closest(".board-node") ||
      event.target.closest(".board-link") ||
      event.target.closest(".board-link-hitarea")
    ) {
      return;
    }

    hideContextMenu();

    if (editorState.linking) {
      cancelLinkMode();
    }

    editorState.selectedNodeId = null;
    editorState.panning = {
      startClient: { x: event.clientX, y: event.clientY },
      startPan: { x: editorState.pan.x, y: editorState.pan.y },
    };
    scheduleRender();
  }

  function handleNodePointerDown(event) {
    if (event.button !== 0) {
      return;
    }

    const nodeElement = event.target.closest(".board-node");

    if (!nodeElement) {
      return;
    }

    const nodeId = nodeElement.dataset.nodeId;
    const node = getNodeById(nodeId);

    if (!node) {
      return;
    }

    if (editorState.linking) {
      event.preventDefault();
      completeLink(nodeId);
      return;
    }

    hideContextMenu();

    const isEditableLabelTarget = Boolean(
      event.target.closest('.board-node__label[data-editable="true"]')
    );
    const activeEditableLabel = document.activeElement;
    const isEditingThisNode =
      activeEditableLabel?.isContentEditable &&
      activeEditableLabel.classList?.contains("board-node__label") &&
      activeEditableLabel.closest(".board-node") === nodeElement;
    const wasSelected = editorState.selectedNodeId === nodeId;

    if (isEditableLabelTarget || isEditingThisNode) {
      if (!wasSelected) {
        editorState.selectedNodeId = nodeId;
        scheduleRender();
      }
      return;
    }

    event.preventDefault();
    bringNodeToFront(nodeId);
    editorState.selectedNodeId = nodeId;
    editorState.draggingNodeId = nodeId;
    const pointerWorld = clientToWorld(event.clientX, event.clientY);
    editorState.dragPointerOffset = {
      x: pointerWorld.x - node.x,
      y: pointerWorld.y - node.y,
    };
    scheduleRender();
  }

  function handleBoardContextMenu(event) {
    if (event.target.closest(".board-link") || event.target.closest(".board-link-hitarea")) {
      return;
    }

    event.preventDefault();
    cancelLinkMode();

    const nodeElement = event.target.closest(".board-node");

    if (nodeElement) {
      const nodeId = nodeElement.dataset.nodeId;

      if (!nodeId) {
        return;
      }

      editorState.selectedNodeId = nodeId;
      scheduleRender();
      showContextMenu(event.clientX, event.clientY, {
        kind: "node",
        nodeId,
      });
      return;
    }

    editorState.selectedNodeId = null;
    scheduleRender();
    showContextMenu(event.clientX, event.clientY, {
      kind: "canvas",
      worldPoint: clientToWorld(event.clientX, event.clientY),
    });
  }

  function handleCanvasWheel(event) {
    event.preventDefault();

    const zoomMultiplier = event.deltaY < 0 ? 1.12 : 0.89;
    editorState.zoom = clamp(editorState.zoom * zoomMultiplier, MIN_ZOOM, MAX_ZOOM);
    persistBoardState();
    scheduleRender();
  }

  function handleDocumentPointerDown(event) {
    if (!event.target.closest(".context-menu")) {
      hideContextMenu();
    }
  }

  function handleContextMenuClick(event) {
    if (!editorState.contextMenu) {
      return;
    }

    const swatch = event.target.closest("[data-color-id]");

    if (swatch && editorState.contextMenu.kind === "node") {
      const node = getNodeById(editorState.contextMenu.nodeId);

      if (!node) {
        return;
      }

      node.colorId = swatch.dataset.colorId;
      persistBoardState();
      scheduleRender();
      hideContextMenu();
      return;
    }

    const button = event.target.closest("[data-menu-action]");

    if (!button) {
      return;
    }

    const action = button.dataset.menuAction;
    const context = editorState.contextMenu;

    hideContextMenu();

    if (action === "add-node" && context?.kind === "canvas" && context.worldPoint) {
      addNodeAtWorld(context.worldPoint.x, context.worldPoint.y);
      return;
    }

    if (action === "edit-node" && context?.kind === "node") {
      openEditModal(context.nodeId);
      return;
    }

    if (action === "start-link" && context?.kind === "node") {
      startLinkMode(context.nodeId);
      return;
    }

    if (action === "delete-node" && context?.kind === "node") {
      deleteNode(context.nodeId);
      return;
    }

    if (action === "delete-link" && context?.kind === "link") {
      deleteLink(context.linkId);
    }
  }

  if (generateBtn) {
    generateBtn.addEventListener("click", handleGeneratePrototype);
  }

  if (openTabBtn) {
    openTabBtn.addEventListener("click", openPrototypeInNewTab);
  }

  if (downloadGameBtn) {
    downloadGameBtn.addEventListener("click", downloadGeneratedPrototypeZip);
  }

  if (previewSizeToggleBtn) {
    previewSizeToggleBtn.addEventListener("click", togglePreviewMaximized);
  }

  if (previewBackdrop) {
    previewBackdrop.addEventListener("click", function () {
      setPreviewMaximized(false);
    });
  }

  boardCanvas.addEventListener("pointerdown", handleCanvasPointerDown);
  boardCanvas.addEventListener("contextmenu", handleBoardContextMenu);
  boardCanvas.addEventListener("wheel", handleCanvasWheel, { passive: false });

  boardNodes.addEventListener("pointerdown", handleNodePointerDown);

  canvasContextMenu.addEventListener("click", handleContextMenuClick);

  if (editNodeSaveBtn) {
    editNodeSaveBtn.addEventListener("click", saveEditedNodeLabel);
  }

  if (editNodeCancelBtn) {
    editNodeCancelBtn.addEventListener("click", closeEditModal);
  }

  if (editNodeModalBackdrop) {
    editNodeModalBackdrop.addEventListener("click", closeEditModal);
  }

  if (editNodeInput) {
    editNodeInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        saveEditedNodeLabel();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeEditModal();
      }
    });
  }

  if (editorAssistantFab) {
    editorAssistantFab.addEventListener("click", toggleEditorAssistant);
  }

  if (editorAssistantForm) {
    editorAssistantForm.addEventListener("submit", handleEditorAssistantSubmit);
  }

  if (editorAssistantUpload && editorAssistantImageInput) {
    editorAssistantUpload.addEventListener("click", function () {
      editorAssistantImageInput.click();
    });
  }

  if (editorAssistantImageInput) {
    editorAssistantImageInput.addEventListener("change", handleAssistantImageSelection);
  }

  if (editorAssistantClearImage) {
    editorAssistantClearImage.addEventListener("click", clearPendingChatImage);
  }

  document.addEventListener("pointerdown", handleDocumentPointerDown);
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("resize", scheduleRender);
  window.addEventListener("load", loadPrototypeStateFromUrl);
  window.addEventListener("beforeunload", clearPrototypeUrl);
  document.addEventListener("keydown", function (event) {
    if (!editNodeModal?.classList.contains("hidden") && event.key === "Escape") {
      closeEditModal();
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      const normalizedKey = String(event.key || "").toLowerCase();

      if (normalizedKey.length === 1) {
        updateDebugSequence(normalizedKey);
      }
    }

    if (event.key === "Escape") {
      hideContextMenu();

      if (editorState.linking) {
        cancelLinkMode();
        return;
      }

      editorState.selectedNodeId = null;
      scheduleRender();
      return;
    }

    if ((event.key === "Delete" || event.key === "Backspace") && editorState.selectedNodeId) {
      const activeElement = document.activeElement;
      const isTyping =
        activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          activeElement.isContentEditable);

      if (!isTyping) {
        deleteNode();
      }
    }
  });

  initializeBoard();
})();
