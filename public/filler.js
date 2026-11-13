// Lines that carry nothing to act on: backchannel, thanks, laughter. When
// every line since Cue last looked is one of these, a think call can only
// answer "quiet", so the page skips it. Shared with evals/replay.mjs, which
// scores the skip. Kept narrow on purpose: a line that isn't plainly filler
// goes to the model.
const FILLER = /^(?:(?:yeah|yep|yup|yes|ok(?:ay)?|sure|right|cool|nice|great|good|alright|all right|got it|makes sense|sounds good|true|exactly|totally|agreed|fair|fair enough|thanks|thank you|ha(?:ha)*|lol|wow|oh|ah|hmm+|mm+(?:-?hmm)?|uh-?huh|um+|uh+|sorry|go ahead|perfect)[\s,.!?]*)+$/i;

export const isFiller = (text) => FILLER.test(String(text).trim());

/** True when there is at least one line and all of them are filler. */
export const allFiller = (lines) => lines.length > 0 && lines.every((l) => isFiller(l.text));
