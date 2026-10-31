/** Reads text aloud with the browser's built-in voices. Silently does nothing where speech is unavailable. */

type Locale = 'en' | 'ar';

const languages: Record<Locale, string> = { en: 'en-GB', ar: 'ar-SA' };

export function speechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

/** The best installed voice for the language: an exact regional match, then any voice in that language. */
function voiceFor(locale: Locale) {
  const voices = window.speechSynthesis.getVoices();
  const wanted = languages[locale].toLowerCase();
  return (
    voices.find((voice) => voice.lang.toLowerCase() === wanted) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(`${locale}-`) || voice.lang.toLowerCase() === locale) ??
    null
  );
}

/** Queues the text after anything already being read, so back-to-back tickets are all heard. */
export function speak(text: string, locale: Locale) {
  if (!speechSupported() || !text.trim()) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = languages[locale];
  const voice = voiceFor(locale);
  if (voice) utterance.voice = voice;
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (speechSupported()) window.speechSynthesis.cancel();
}

/** Browsers only let a page talk after the user has interacted with it; a silent line on a tap unlocks it. */
export function primeSpeech() {
  if (!speechSupported()) return;
  const silent = new SpeechSynthesisUtterance(' ');
  silent.volume = 0;
  window.speechSynthesis.speak(silent);
}
