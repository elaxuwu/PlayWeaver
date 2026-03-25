async function askPlayWeaverAI(messageHistory) {
  const response = await fetch("/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messageHistory }),
  });

  if (!response.ok) {
    throw new Error(`PlayWeaver AI request failed with status ${response.status}`);
  }

  const aiReply = await response.text();

  try {
    const parsedReply = JSON.parse(aiReply);

    if (parsedReply && parsedReply.isComplete === true) {
      localStorage.setItem("playweaverGameConfig", JSON.stringify(parsedReply));
      window.location.href = "/editor.html";
      return parsedReply;
    }
  } catch (error) {
    // The assistant returned normal text, so we surface it to the chat UI.
  }

  return aiReply;
}

window.askPlayWeaverAI = askPlayWeaverAI;
