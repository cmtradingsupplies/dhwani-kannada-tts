export const MAX_LENGTH = 2000;
export const LOCALE = "kn-IN";

export const messages = {
  empty: ["ದಯವಿಟ್ಟು ಪಠ್ಯವನ್ನು ನಮೂದಿಸಿ.", "Enter some text to continue."],
  tooLong: ["ಪಠ್ಯವು 2,000 ಅಕ್ಷರಗಳ ಒಳಗಿರಲಿ.", "Keep your text within 2,000 characters."],
  kannada: ["ದಯವಿಟ್ಟು ಕನ್ನಡ ಪಠ್ಯವನ್ನು ಸೇರಿಸಿ.", "Include at least one Kannada character."],
  invalid: ["ಪಠ್ಯ ಅಥವಾ ಧ್ವನಿ ಸೆಟ್ಟಿಂಗ್‌ಗಳನ್ನು ಪರಿಶೀಲಿಸಿ.", "Check your text and voice settings."],
  busy: ["ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.", "The speech server is busy. Try again shortly."],
  expired: ["ಧ್ವನಿ ವಿನಂತಿಯ ಅವಧಿ ಮುಗಿದಿದೆ.", "This audio session expired or the server restarted. Select Speak to try again."],
  setup: ["ಸ್ಥಳೀಯ ಕನ್ನಡ ಧ್ವನಿಯ ಸೆಟಪ್ ಇನ್ನೂ ಪೂರ್ಣಗೊಂಡಿಲ್ಲ.", "The local Kannada voice is not installed. Run the voice setup in the README."],
  unavailable: ["ಈಗ ಧ್ವನಿ ರಚಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.", "Couldn’t generate audio. Try again or use your device’s voice."],
  noVoice: ["ಈ ಸಾಧನದಲ್ಲಿ ಕನ್ನಡ ಧ್ವನಿ ಲಭ್ಯವಿಲ್ಲ.", "A Kannada voice isn’t available on this device."],
  playback: ["ಧ್ವನಿಯನ್ನು ಪ್ಲೇ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.", "Audio playback failed. Try again or download the MP3."],
} as const;

export type ErrorCode = keyof typeof messages;

export function validateText(text: string): ErrorCode | null {
  if (!text.trim()) return "empty";
  if (text.length > MAX_LENGTH) return "tooLong";
  if (!/[\u0C80-\u0CFF]/u.test(text)) return "kannada";
  // Reject characters that XML 1.0 cannot represent, including unpaired surrogates.
  if (/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(text)) return "invalid";
  return null;
}

export function signed(value: number, unit: "%" | "st") {
  return `${value >= 0 ? "+" : ""}${value}${unit}`;
}
