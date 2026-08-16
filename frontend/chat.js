// Mock chat behavior only — no AI API, database, or authentication connected.

const chatArea = document.getElementById("chatArea");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

const MOCK_BOT_REPLIES = [
  "Thanks for your message! (This is a mock reply — CafeBot isn't connected to a real AI yet.)",
  "Got it! (Mock response — no live ordering logic wired up yet.)",
  "Noted! (This is placeholder UI text for testing the chat layout.)",
];

function addMessage(text, sender) {
  const message = document.createElement("div");
  message.className = `message ${sender}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  message.appendChild(bubble);
  chatArea.appendChild(message);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function getMockReply() {
  const index = Math.floor(Math.random() * MOCK_BOT_REPLIES.length);
  return MOCK_BOT_REPLIES[index];
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = chatInput.value.trim();
  if (!text) return;

  addMessage(text, "customer");
  chatInput.value = "";
  chatInput.focus();

  // Mock bot reply after a short delay to simulate a response.
  setTimeout(() => addMessage(getMockReply(), "bot"), 500);
});
