const ideaForm = document.getElementById("idea-form");
const ideaInput = document.getElementById("game-idea");
const weaveButton = document.getElementById("weave-button");
const loadingMessage = document.getElementById("loading-message");
const yearNode = document.getElementById("year");

const loadingStages = [
  "Mapping mechanics, building a visual whiteboard, and preparing an HTML5 game shell.",
  "Synthesizing a first-pass gameplay loop and scene layout.",
  "Assembling a hypothetical loading state for your prototype handoff.",
];

if (yearNode) {
  yearNode.textContent = new Date().getFullYear();
}

if (ideaForm && ideaInput && weaveButton && loadingMessage) {
  ideaForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const prompt = ideaInput.value.trim();
    console.log("PlayWeaver prompt:", prompt);

    weaveButton.disabled = true;
    document.body.classList.add("is-loading");
    loadingMessage.textContent = prompt ? `Weaving: ${prompt}` : loadingStages[0];

    let stageIndex = 0;
    const stageTimer = window.setInterval(() => {
      loadingMessage.textContent = loadingStages[stageIndex];
      stageIndex += 1;

      if (stageIndex >= loadingStages.length) {
        window.clearInterval(stageTimer);
      }
    }, 1300);
  });
}
