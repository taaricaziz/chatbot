// In-memory SMS conversation history, keyed by phone number. No database — state is lost on server restart.
const histories = new Map();

function getSmsHistory(phoneNumber) {
  if (!histories.has(phoneNumber)) {
    histories.set(phoneNumber, []);
  }
  return histories.get(phoneNumber);
}

module.exports = { getSmsHistory };
