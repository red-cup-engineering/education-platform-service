/** Pure derived grading for objective review cards. */

function normalizeAnswer(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
    .replace(/\s+/gu, ' ').replace(/\p{P}/gu, '').trim();
}

function levenshtein(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

/** Derive an FSRS grade from a checked response; self-graded cards are rejected. */
export function gradeResponse(card, response) {
  if (Array.isArray(card.choices)) {
    if (!response || typeof response.roomId !== 'string') throw new TypeError('choice response.roomId must be a string');
    const answer = card.choices.find((choice) => choice.roomId === card.roomId);
    if (!answer) throw new TypeError('choice card must include its answer room');
    const correct = response.roomId === card.roomId;
    return { correct, grade: correct ? 3 : 1, expected: answer.label, ...(!correct && { chosenRoomId: response.roomId }) };
  }
  if (Array.isArray(card.accepts)) {
    if (!response || typeof response.text !== 'string') throw new TypeError('typed response.text must be a string');
    const offered = normalizeAnswer(response.text);
    const accepted = card.accepts.map(normalizeAnswer);
    const correct = accepted.includes(offered);
    if (correct) return { correct: true, grade: 3, expected: card.accepts[0] };
    const near = accepted.some((answer) => answer.length >= 6 && levenshtein(offered, answer) === 1);
    return { correct: false, grade: near ? 2 : 1, expected: card.accepts[0] };
  }
  throw new TypeError('card has no objective answer mode');
}
