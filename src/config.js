export const defaultMessages = { isRequired: "is required" };

export function getMessage(key, messages) {
  return messages[key] || defaultMessages[key];
}

export function setMessages(messages) {
  Object.assign(defaultMessages, messages);
}
