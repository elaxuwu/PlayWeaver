async function askPlayWeaverAI(messageHistory) {
  const response = await fetch("/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messageHistory }),
  });

  if (!response.ok) {
    let errorMessage = `PlayWeaver AI request failed with status ${response.status}`;

    try {
      const errorPayload = await response.json();

      if (errorPayload?.error && typeof errorPayload.error === "string") {
        errorMessage = errorPayload.error;
      }
    } catch (parseError) {
      console.error("Failed to parse PlayWeaver AI error payload:", parseError);
    }

    throw new Error(errorMessage);
  }

  const parsedReply = await response.json();

  if (!parsedReply || typeof parsedReply !== "object") {
    throw new Error("PlayWeaver AI returned an invalid response shape.");
  }

  if (parsedReply.isComplete === true) {
    const boardState =
      parsedReply.boardState && typeof parsedReply.boardState === "object"
        ? parsedReply.boardState
        : parsedReply;

    localStorage.setItem("playweaverGameConfig", JSON.stringify(boardState));
    window.location.href = "/editor.html";
  }

  return parsedReply;
}

window.askPlayWeaverAI = askPlayWeaverAI;
