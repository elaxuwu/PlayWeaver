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
  };
  let cloudSyncTimeoutId = null;

  function defaultPan() {
    return {
      x: 0,
      y: 0,
    };
  }

  function getDefaultGameConfig() {
    return FIELD_DEFINITIONS.reduce((config, field) => {
      config[field.key] = field.key === "gameName" ? "Untitled Game" : "None";
      return config;
    }, {});
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

    return FIELD_DEFINITIONS.reduce((normalized, field) => {
      normalized[field.key] = normalizeStoredValue(config?.[field.key], defaults[field.key]);
      return normalized;
    }, {});
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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
    if (node.kind === "title") {
      return window.innerWidth <= 720 ? 240 : 272;
    }

    if (node.kind === "field") {
      return 192;
    }

    return window.innerWidth <= 720 ? 224 : 256;
  }

  function getNodeHeight(node) {
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

    return {
      nodes,
      links,
      pan: {
        x: Number.isFinite(panX) ? panX : fallbackPan.x,
        y: Number.isFinite(panY) ? panY : fallbackPan.y,
      },
      zoom: Number.isFinite(zoom) ? clamp(zoom, MIN_ZOOM, MAX_ZOOM) : 1,
      signature: typeof rawState.signature === "string" ? rawState.signature : "",
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

  function setCurrentGeneratedHtml(html) {
    editorState.currentGeneratedHtml = typeof html === "string" ? html : "";
    clearPrototypeUrl();

    if (gameFrame) {
      gameFrame.srcdoc = editorState.currentGeneratedHtml;
    }

    updateOpenInNewTabState();
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
        html: typeof editorState.currentGeneratedHtml === "string" ? editorState.currentGeneratedHtml : "",
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

      if (response.status === 401 && window.PlayWeaverAuth?.clearSession) {
        window.PlayWeaverAuth.clearSession();
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

    setCurrentGeneratedHtml(typeof projectState?.html === "string" ? projectState.html : "");
    writeProjectStateToLocalStorage(buildPersistedBoardState(normalizedGameConfig), normalizedGameConfig);
    updateMetadata(normalizedGameConfig);
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
    if (!editorState.currentGeneratedHtml) {
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
        await zip.file("index.html", editorState.currentGeneratedHtml).generateAsync({
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
        const color = getColorToken(node.colorId, node.kind);
        const position = nodeToScreenPosition(node);
        const selected = node.id === editorState.selectedNodeId;
        const classes = [
          "board-node",
          `board-node--${node.kind}`,
          selected ? "is-selected" : "",
          node.locked ? "is-locked" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const kindLabel =
          node.kind === "title" ? "Game Title" : node.kind === "field" ? "Category" : "Node";
        const labelAttributes = 'data-editable="false"';

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
            "
          >
            <span class="board-node__kind">${kindLabel}</span>
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
    const nextNodeId = createNodeId("note");
    const nextNode = {
      id: nextNodeId,
      kind: "note",
      label: "New note",
      x: worldX,
      y: worldY,
      locked: false,
      colorId: "gold",
    };

    editorState.nodes.push(nextNode);
    editorState.selectedNodeId = nextNodeId;
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
    if (!editorState.currentGeneratedHtml) {
      setGenerateStatus("Generate a prototype before opening a new tab.");
      return;
    }

    clearPrototypeUrl();

    const htmlBlob = new Blob([editorState.currentGeneratedHtml], { type: "text/html" });
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

  async function handleGeneratePrototype() {
    const payload = buildGenerationPayload();
    const isRegenerating = Boolean(editorState.currentGeneratedHtml);

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
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(getPrototypeErrorMessage(errorText, response.status));
      }

      const generatedHtml = await response.text();
      setCurrentGeneratedHtml(generatedHtml);

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

    updateMetadata(buildGenerationPayload().gameConfig);
    setGenerateStatus(READY_STATUS);
    setPreviewMaximized(false);
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
