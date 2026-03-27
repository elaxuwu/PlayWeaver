(function () {
  const STORAGE_KEY = "playweaverGameConfig";
  const EDITOR_STATE_KEY = "playweaverEditorStateV2";
  const READY_STATUS = "Ready to generate a playable prototype.";
  const GRID_SIZE = 56;
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
  const deleteSelectedBtn = document.getElementById("delete-selected-btn");
  const centerBoardBtn = document.getElementById("center-board-btn");
  const nodeCount = document.getElementById("node-count");
  const linkCount = document.getElementById("link-count");
  const boardCanvas = document.getElementById("board-canvas");
  const boardNodes = document.getElementById("board-nodes");
  const boardLinks = document.getElementById("board-links");
  const nodeColorMenu = document.getElementById("node-color-menu");
  const nodeColorSwatches = document.getElementById("node-color-swatches");
  const canvasContextMenu = document.getElementById("canvas-context-menu");
  const linkHint = document.getElementById("link-hint");
  const mindmapStatus = document.getElementById("mindmap-status");
  const generateStatus = document.getElementById("generate-status");
  const gameFrame = document.getElementById("game-frame");
  const gameLoadingOverlay = document.getElementById("game-loading-overlay");
  const gameLoadingText = document.getElementById("game-loading-text");

  const editorState = {
    nodes: [],
    links: [],
    pan: defaultPan(),
    selectedNodeId: null,
    draggingNodeId: null,
    dragPointerOffset: { x: 0, y: 0 },
    panning: null,
    linking: null,
    editingNodeId: null,
    currentGeneratedHtml: "",
    currentPrototypeUrl: null,
    nodeIdCounter: 0,
    renderQueued: false,
    contextMenuItems: [],
  };

  function defaultPan() {
    return {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2 - 70,
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
      x: node.x + editorState.pan.x,
      y: node.y + editorState.pan.y,
    };
  }

  function getNodeCenter(nodeId) {
    const node = getNodeById(nodeId);

    if (!node) {
      return null;
    }

    const element = getNodeElement(nodeId);

    if (element) {
      return {
        x: element.offsetLeft + element.offsetWidth / 2,
        y: element.offsetTop + element.offsetHeight / 2,
      };
    }

    const position = nodeToScreenPosition(node);
    return {
      x: position.x + getNodeWidth(node) / 2,
      y: position.y + getNodeHeight(node) / 2,
    };
  }

  function clientToWorld(clientX, clientY) {
    return {
      x: clientX - editorState.pan.x,
      y: clientY - editorState.pan.y,
    };
  }

  function createNodeId(prefix) {
    editorState.nodeIdCounter += 1;
    return `${prefix}_${Date.now()}_${editorState.nodeIdCounter}`;
  }

  function createConfigSignature(config) {
    return JSON.stringify(normalizeGameConfig(config));
  }

  function createInitialBoardState(config) {
    const nodes = [
      {
        id: "title",
        kind: "title",
        label: normalizeStoredValue(config.gameName, "Untitled Game"),
        x: -136,
        y: -220,
        locked: false,
        colorId: "sky",
      },
    ];
    const links = [];

    BASE_FIELDS.forEach((field, index) => {
      const isLeftColumn = index % 2 === 0;
      const row = Math.floor(index / 2);
      const fieldX = isLeftColumn ? -520 : 168;
      const noteX = isLeftColumn ? -252 : 428;
      const y = -120 + row * 168;
      const noteColor = NODE_COLORS[(index + 1) % NODE_COLORS.length]?.id || "mint";

      nodes.push({
        id: field.key,
        kind: "field",
        label: field.label,
        x: fieldX,
        y,
        locked: true,
        colorId: "slate",
      });

      nodes.push({
        id: `${field.key}_value`,
        kind: "note",
        label: normalizeStoredValue(config[field.key], "None"),
        x: noteX,
        y: y + 18,
        locked: false,
        colorId: noteColor,
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
      signature: createConfigSignature(config),
    };
  }

  function normalizeBoardState(rawState) {
    if (!rawState || typeof rawState !== "object") {
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
          id:
            typeof link.id === "string" && link.id
              ? link.id
              : `link_${from}_${to}`,
          from,
          to,
        };
      })
      .filter(Boolean);

    return {
      nodes,
      links,
      pan: {
        x: Number(rawState.pan?.x) || defaultPan().x,
        y: Number(rawState.pan?.y) || defaultPan().y,
      },
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

  function setBoardStatus(message) {
    if (mindmapStatus) {
      mindmapStatus.textContent = message;
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

  function collectFieldValues(fieldId, adjacency) {
    const queue = [...(adjacency.get(fieldId) || [])];
    const visited = new Set([fieldId]);
    const collected = [];

    while (queue.length) {
      const currentId = queue.shift();

      if (visited.has(currentId)) {
        continue;
      }

      visited.add(currentId);

      if (FIELD_IDS.has(currentId)) {
        continue;
      }

      const node = getNodeById(currentId);

      if (!node || node.kind === "title") {
        continue;
      }

      const normalizedLabel = normalizeStoredValue(node.label, "");

      if (normalizedLabel && normalizedLabel.toLowerCase() !== "none") {
        collected.push(normalizedLabel);
      }

      const neighbors = adjacency.get(currentId) || [];
      neighbors.forEach((neighborId) => {
        if (!visited.has(neighborId) && !FIELD_IDS.has(neighborId)) {
          queue.push(neighborId);
        }
      });
    }

    return Array.from(new Set(collected));
  }

  function getUpdatedGameConfigFromBoard() {
    const nextConfig = getDefaultGameConfig();
    const titleNode = getNodeById("title");
    const adjacency = buildAdjacencyMap();

    nextConfig.gameName = normalizeStoredValue(titleNode?.label, "Untitled Game");

    BASE_FIELDS.forEach((field) => {
      const values = collectFieldValues(field.key, adjacency);
      nextConfig[field.key] = values.length ? values.join(", ") : "None";
    });

    return normalizeGameConfig(nextConfig);
  }

  function persistBoardState() {
    const nextConfig = getUpdatedGameConfigFromBoard();

    try {
      localStorage.setItem(
        EDITOR_STATE_KEY,
        JSON.stringify({
          version: 2,
          nodes: editorState.nodes,
          links: editorState.links,
          pan: editorState.pan,
          signature: createConfigSignature(nextConfig),
        })
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextConfig));
    } catch (error) {
      console.error("Failed to persist editor state:", error);
    }
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

  function renderNodes() {
    boardNodes.innerHTML = editorState.nodes
      .map((node) => {
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
          node.kind === "title" ? "Game Title" : node.kind === "field" ? "Field" : "Note";

        return `
          <article
            class="${classes}"
            data-node-id="${escapeHtml(node.id)}"
            style="
              left:${position.x}px;
              top:${position.y}px;
              --node-surface:${color.surface};
              --node-border:${color.border};
              --node-glow:${color.glow};
              --node-ink:${color.ink};
            "
          >
            <span class="board-node__kind">${kindLabel}</span>
            <div class="board-node__label" spellcheck="false">${escapeHtml(node.label)}</div>
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

      paths.push(`<path class="board-link" d="${buildLinkPath(from, to)}"></path>`);
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

  function renderColorMenu() {
    if (!nodeColorMenu || !nodeColorSwatches || !editorState.selectedNodeId || editorState.editingNodeId) {
      if (nodeColorMenu) {
        nodeColorMenu.classList.add("hidden");
      }
      return;
    }

    const node = getNodeById(editorState.selectedNodeId);
    const nodeElement = getNodeElement(editorState.selectedNodeId);

    if (!node || !nodeElement) {
      nodeColorMenu.classList.add("hidden");
      return;
    }

    nodeColorSwatches.innerHTML = NODE_COLORS.map((preset) => {
      const activeClass = preset.id === node.colorId ? "is-active" : "";

      return `
        <button
          type="button"
          class="floating-palette__swatch ${activeClass}"
          data-color-id="${preset.id}"
          aria-label="Apply ${preset.id} color"
          style="background:${preset.surface}; border-color:${preset.border};"
        ></button>
      `;
    }).join("");

    nodeColorMenu.classList.remove("hidden");

    const rect = nodeElement.getBoundingClientRect();
    const paletteWidth = 188;
    const offsetX = rect.right + paletteWidth > window.innerWidth - 12 ? -paletteWidth - 14 : 14;
    const x = rect.right + offsetX;
    const y = rect.top + rect.height / 2 - 40;

    positionFloatingElement(nodeColorMenu, x, y);
  }

  function hideContextMenu() {
    editorState.contextMenuItems = [];
    canvasContextMenu.classList.add("hidden");
  }

  function showContextMenu(x, y, items) {
    editorState.contextMenuItems = items;
    canvasContextMenu.innerHTML = items
      .map(
        (item, index) => `
          <button type="button" class="context-menu__button" data-menu-index="${index}">
            <span class="context-menu__symbol">${item.symbol}</span>
            <span>${item.label}</span>
          </button>
        `
      )
      .join("");
    canvasContextMenu.classList.remove("hidden");
    positionFloatingElement(canvasContextMenu, x, y);
  }

  function renderLinkHint() {
    if (!linkHint) {
      return;
    }

    linkHint.classList.toggle("hidden", !editorState.linking);
  }

  function renderEditor() {
    updateMetadata(getUpdatedGameConfigFromBoard());
    updateCounts();
    updateOpenInNewTabState();

    boardCanvas.style.setProperty("--grid-offset-x", `${editorState.pan.x % GRID_SIZE}px`);
    boardCanvas.style.setProperty("--grid-offset-y", `${editorState.pan.y % GRID_SIZE}px`);
    boardCanvas.classList.toggle("is-panning", Boolean(editorState.panning));
    boardCanvas.classList.toggle("is-linking", Boolean(editorState.linking));

    renderNodes();
    renderLinks();
    renderColorMenu();
    renderLinkHint();
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

  function setSelectedNode(nodeId) {
    editorState.selectedNodeId = nodeId;
    scheduleRender();
  }

  function clearSelection() {
    editorState.selectedNodeId = null;
    scheduleRender();
  }

  function createLinkId(from, to) {
    return `link_${from}_${to}_${Date.now()}_${editorState.links.length + 1}`;
  }

  function hasLinkBetween(nodeA, nodeB) {
    return editorState.links.some(
      (link) =>
        (link.from === nodeA && link.to === nodeB) || (link.from === nodeB && link.to === nodeA)
    );
  }

  function addNodeAt(clientX, clientY) {
    const worldPoint = clientToWorld(clientX, clientY);
    const nextNodeId = createNodeId("note");
    const nextNode = {
      id: nextNodeId,
      kind: "note",
      label: "New note",
      x: worldPoint.x,
      y: worldPoint.y,
      locked: false,
      colorId: "gold",
    };

    editorState.nodes.push(nextNode);
    bringNodeToFront(nextNodeId);
    editorState.selectedNodeId = nextNodeId;
    persistBoardState();
    scheduleRender();
    setBoardStatus("Added a new note. Double-click it to rename.");

    window.requestAnimationFrame(() => {
      beginNodeEdit(nextNodeId);
    });
  }

  function removeLinksForNode(nodeId) {
    const hadLinks = editorState.links.some((link) => link.from === nodeId || link.to === nodeId);
    editorState.links = editorState.links.filter((link) => link.from !== nodeId && link.to !== nodeId);
    return hadLinks;
  }

  function deleteNode(nodeId) {
    const selectedId = nodeId || editorState.selectedNodeId;
    const node = getNodeById(selectedId);

    if (!node) {
      setBoardStatus("Select a node before deleting.");
      return;
    }

    if (node.kind === "title") {
      setBoardStatus("The title card stays in place so the game always has a name.");
      return;
    }

    if (node.locked || node.kind === "field") {
      setBoardStatus("Schema field cards stay pinned so PlayWeaver can map your concept correctly.");
      return;
    }

    editorState.nodes = editorState.nodes.filter((item) => item.id !== selectedId);
    removeLinksForNode(selectedId);

    if (editorState.linking?.fromNodeId === selectedId) {
      editorState.linking = null;
    }

    if (editorState.editingNodeId === selectedId) {
      editorState.editingNodeId = null;
    }

    editorState.selectedNodeId = null;
    persistBoardState();
    scheduleRender();
    setBoardStatus("Removed the selected node.");
  }

  function startLinkMode(fromNodeId) {
    editorState.linking = {
      fromNodeId,
      pointer: getNodeCenter(fromNodeId),
    };
    setSelectedNode(fromNodeId);
    hideContextMenu();
    setBoardStatus("Link mode is active. Click another node to connect the line.");
    scheduleRender();
  }

  function cancelLinkMode(message) {
    if (!editorState.linking) {
      return;
    }

    editorState.linking = null;
    setBoardStatus(message || "Link mode cancelled.");
    scheduleRender();
  }

  function completeLink(targetNodeId) {
    if (!editorState.linking) {
      return;
    }

    const fromNodeId = editorState.linking.fromNodeId;

    if (fromNodeId === targetNodeId) {
      cancelLinkMode("Choose a different node to complete the link.");
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
    setBoardStatus("Linked the two nodes.");
    scheduleRender();
  }

  function beginNodeEdit(nodeId) {
    const node = getNodeById(nodeId);

    if (!node || node.locked) {
      setBoardStatus("Field labels stay fixed so PlayWeaver can keep the board schema aligned.");
      return;
    }

    const nodeElement = getNodeElement(nodeId);
    const labelElement = nodeElement?.querySelector(".board-node__label");

    if (!labelElement) {
      return;
    }

    editorState.editingNodeId = nodeId;
    hideContextMenu();
    nodeColorMenu.classList.add("hidden");
    labelElement.setAttribute("contenteditable", "true");
    labelElement.focus();

    const selection = window.getSelection();

    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(labelElement);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  function finishNodeEdit(shouldCommit) {
    const nodeId = editorState.editingNodeId;

    if (!nodeId) {
      return;
    }

    const node = getNodeById(nodeId);
    const nodeElement = getNodeElement(nodeId);
    const labelElement = nodeElement?.querySelector(".board-node__label");

    if (!node || !labelElement) {
      editorState.editingNodeId = null;
      scheduleRender();
      return;
    }

    if (shouldCommit) {
      const fallback =
        node.kind === "title" ? "Untitled Game" : node.kind === "note" ? "New note" : node.label;
      node.label = normalizeStoredValue(labelElement.textContent, fallback);
      persistBoardState();
      setBoardStatus(`Updated the ${node.kind === "title" ? "title" : "node"} text.`);
    }

    labelElement.removeAttribute("contenteditable");
    editorState.editingNodeId = null;
    scheduleRender();
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
    const updatedGameConfig = getUpdatedGameConfigFromBoard();
    const isRegenerating = Boolean(editorState.currentGeneratedHtml);

    persistBoardState();
    updateMetadata(updatedGameConfig);

    if (generateBtn) {
      generateBtn.disabled = true;
    }

    if (openTabBtn) {
      openTabBtn.disabled = true;
    }

    setLoadingOverlay(true, isRegenerating);
    setGenerateStatus(
      isRegenerating
        ? "Regenerating prototype from the latest board..."
        : "Generating prototype from the latest board..."
    );

    try {
      const response = await fetch("/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameConfig: updatedGameConfig }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(getPrototypeErrorMessage(errorText, response.status));
      }

      editorState.currentGeneratedHtml = await response.text();
      updateOpenInNewTabState();

      if (gameFrame) {
        gameFrame.srcdoc = editorState.currentGeneratedHtml;
      }

      setGenerateStatus("Prototype ready. Play it in the floating preview.");
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

  function centerBoardOnTitle() {
    const titleNode = getNodeById("title");

    if (!titleNode) {
      editorState.pan = defaultPan();
      scheduleRender();
      return;
    }

    editorState.pan = {
      x: window.innerWidth / 2 - (titleNode.x + getNodeWidth(titleNode) / 2),
      y: window.innerHeight / 2 - (titleNode.y + getNodeHeight(titleNode) / 2) - 60,
    };

    persistBoardState();
    scheduleRender();
    setBoardStatus("Recentered the canvas around the title card.");
  }

  function handlePointerMove(event) {
    if (editorState.panning) {
      editorState.pan = {
        x: editorState.panning.startPan.x + (event.clientX - editorState.panning.startClient.x),
        y: editorState.panning.startPan.y + (event.clientY - editorState.panning.startClient.y),
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
      editorState.linking.pointer = {
        x: event.clientX,
        y: event.clientY,
      };
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
    if (event.button !== 0 || event.target.closest(".board-node")) {
      return;
    }

    if (editorState.editingNodeId) {
      finishNodeEdit(true);
    }

    if (editorState.linking) {
      cancelLinkMode("Link mode cancelled.");
    }

    hideContextMenu();
    clearSelection();
    editorState.panning = {
      startClient: { x: event.clientX, y: event.clientY },
      startPan: { x: editorState.pan.x, y: editorState.pan.y },
    };
    setBoardStatus("Panning the canvas.");
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

    if (!nodeId) {
      return;
    }

    if (editorState.editingNodeId) {
      if (editorState.editingNodeId !== nodeId) {
        finishNodeEdit(true);
      } else {
        return;
      }
    }

    if (editorState.linking) {
      event.preventDefault();
      completeLink(nodeId);
      return;
    }

    const node = getNodeById(nodeId);

    if (!node) {
      return;
    }

    event.preventDefault();
    hideContextMenu();
    bringNodeToFront(nodeId);
    setSelectedNode(nodeId);
    editorState.draggingNodeId = nodeId;
    editorState.dragPointerOffset = {
      x: event.clientX - editorState.pan.x - node.x,
      y: event.clientY - editorState.pan.y - node.y,
    };
    setBoardStatus("Dragging node.");
  }

  function handleBoardContextMenu(event) {
    event.preventDefault();

    const nodeElement = event.target.closest(".board-node");

    if (nodeElement) {
      const nodeId = nodeElement.dataset.nodeId;
      const node = getNodeById(nodeId);

      if (!node) {
        return;
      }

      setSelectedNode(nodeId);
      showContextMenu(event.clientX, event.clientY, [
        {
          label: "Start Link",
          symbol: "->",
          action: function () {
            startLinkMode(nodeId);
          },
        },
        {
          label: "Remove Links",
          symbol: "x",
          action: function () {
            const removed = removeLinksForNode(nodeId);
            persistBoardState();
            scheduleRender();
            setBoardStatus(removed ? "Removed the node links." : "That node had no links to remove.");
          },
        },
        !node.locked
          ? {
              label: "Delete Node",
              symbol: "-",
              action: function () {
                deleteNode(nodeId);
              },
            }
          : null,
      ].filter(Boolean));
      return;
    }

    editorState.selectedNodeId = null;
    if (nodeColorMenu) {
      nodeColorMenu.classList.add("hidden");
    }
    scheduleRender();

    showContextMenu(event.clientX, event.clientY, [
      {
        label: "Add Node",
        symbol: "+",
        action: function () {
          addNodeAt(event.clientX, event.clientY);
        },
      },
    ]);
  }

  function handleDocumentPointerDown(event) {
    if (!event.target.closest(".context-menu")) {
      hideContextMenu();
    }

    if (!event.target.closest(".floating-palette") && !event.target.closest(".board-node")) {
      nodeColorMenu.classList.add("hidden");
    }
  }

  function initializeBoard() {
    const initialConfig = loadInitialConfig();
    const storedBoard = loadBoardState(initialConfig);

    editorState.nodes = storedBoard.nodes;
    editorState.links = storedBoard.links;
    editorState.pan = storedBoard.pan;

    updateMetadata(getUpdatedGameConfigFromBoard());
    setGenerateStatus(READY_STATUS);
    updateOpenInNewTabState();
    scheduleRender();
  }

  if (generateBtn) {
    generateBtn.addEventListener("click", handleGeneratePrototype);
  }

  if (openTabBtn) {
    openTabBtn.addEventListener("click", openPrototypeInNewTab);
  }

  if (deleteSelectedBtn) {
    deleteSelectedBtn.addEventListener("click", function () {
      deleteNode();
    });
  }

  if (centerBoardBtn) {
    centerBoardBtn.addEventListener("click", centerBoardOnTitle);
  }

  if (boardCanvas) {
    boardCanvas.addEventListener("pointerdown", handleCanvasPointerDown);
    boardCanvas.addEventListener("contextmenu", handleBoardContextMenu);
  }

  if (boardNodes) {
    boardNodes.addEventListener("pointerdown", handleNodePointerDown);
    boardNodes.addEventListener("dblclick", function (event) {
      const nodeElement = event.target.closest(".board-node");

      if (!nodeElement) {
        return;
      }

      beginNodeEdit(nodeElement.dataset.nodeId);
    });

    boardNodes.addEventListener("keydown", function (event) {
      const isEditableLabel =
        event.target.classList && event.target.classList.contains("board-node__label");

      if (!isEditableLabel || editorState.editingNodeId === null) {
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        finishNodeEdit(true);
      }

      if (event.key === "Escape") {
        event.preventDefault();
        finishNodeEdit(false);
      }
    });

    boardNodes.addEventListener(
      "blur",
      function (event) {
        const isEditableLabel =
          event.target.classList && event.target.classList.contains("board-node__label");

        if (isEditableLabel && editorState.editingNodeId) {
          finishNodeEdit(true);
        }
      },
      true
    );
  }

  if (canvasContextMenu) {
    canvasContextMenu.addEventListener("click", function (event) {
      const button = event.target.closest("[data-menu-index]");

      if (!button) {
        return;
      }

      const index = Number(button.dataset.menuIndex);
      const item = editorState.contextMenuItems[index];

      if (item && typeof item.action === "function") {
        item.action();
      }

      hideContextMenu();
    });
  }

  if (nodeColorSwatches) {
    nodeColorSwatches.addEventListener("click", function (event) {
      const swatch = event.target.closest("[data-color-id]");

      if (!swatch || !editorState.selectedNodeId) {
        return;
      }

      const node = getNodeById(editorState.selectedNodeId);

      if (!node) {
        return;
      }

      node.colorId = swatch.dataset.colorId;
      persistBoardState();
      scheduleRender();
      setBoardStatus("Updated the node color.");
    });
  }

  document.addEventListener("pointerdown", handleDocumentPointerDown);
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("resize", scheduleRender);
  window.addEventListener("beforeunload", clearPrototypeUrl);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (editorState.editingNodeId) {
        finishNodeEdit(false);
        return;
      }

      if (editorState.linking) {
        cancelLinkMode();
        return;
      }

      hideContextMenu();
      clearSelection();
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
