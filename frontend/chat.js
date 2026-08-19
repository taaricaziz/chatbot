const chatArea = document.getElementById("chatArea");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const sendButton = chatForm.querySelector(".send-button");

let sessionId = null;
let history = [];

function parseInline(line) {
  return line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = part.slice(2, -2);
      return strong;
    }
    return document.createTextNode(part);
  });
}

function renderBotText(bubble, text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  let currentList = null;

  lines.forEach((line) => {
    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      if (!currentList) {
        currentList = document.createElement("ul");
        bubble.appendChild(currentList);
      }
      const li = document.createElement("li");
      parseInline(bulletMatch[1]).forEach((node) => li.appendChild(node));
      currentList.appendChild(li);
    } else {
      currentList = null;
      const p = document.createElement("p");
      parseInline(line).forEach((node) => p.appendChild(node));
      bubble.appendChild(p);
    }
  });
}

function addMessage(text, sender) {
  const message = document.createElement("div");
  message.className = `message ${sender}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (sender === "bot") {
    renderBotText(bubble, text);
  } else {
    bubble.textContent = text;
  }

  message.appendChild(bubble);
  chatArea.appendChild(message);
  chatArea.scrollTop = chatArea.scrollHeight;
  return message;
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const text = chatInput.value.trim();
  if (!text) return;

  addMessage(text, "customer");
  chatInput.value = "";
  chatInput.focus();
  chatInput.disabled = true;
  sendButton.disabled = true;

  const typingMessage = addMessage("...", "bot");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history, sessionId }),
    });

    const data = await res.json();
    typingMessage.remove();

    if (!res.ok) {
      addMessage(data.error || "Sorry, something went wrong. Please try again.", "bot");
      return;
    }

    sessionId = data.sessionId;
    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: data.reply });
    addMessage(data.reply, "bot");
  } catch (err) {
    typingMessage.remove();
    addMessage("Sorry, I couldn't connect. Please check your connection and try again.", "bot");
  } finally {
    chatInput.disabled = false;
    sendButton.disabled = false;
    chatInput.focus();
  }
});
