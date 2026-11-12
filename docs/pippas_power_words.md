# Pippa's Power Words — Hangman vocabulary and build notes

Transcribed from the two supplied classroom sheets. The lists each contain 50 main words plus one starred bonus word, for **102 entries total**. The `I` on the sheet is stored as lowercase `i` for consistent matching; display it uppercase when appropriate. The source sheets' Reading and Writing checkboxes were unmarked, so the corresponding CSV fields are blank (unknown, not false).

## 50 Power Words

**Left column (25):** again, also, any, are, as, be, because, come, could, do, does, for, from, go, goes, has, he, I, into, is, know, many, me, no, of.

**Right column (25 main + bonus):** one, or, people, put, said, she, should, so, some, the, their, they, to, was, we, were, what, when, where, which, who, why, would, you, your.

**Bonus:** very (often used in information text).

## Power Word Bank

**Left column (25):** about, almost, always, answer, away, before, blue, both, by, done, eight, every, far, father, first, four, girl, give, going, good, have, her, here, his, laugh.

**Right column (25 main + bonus):** love, mother, my, only, other, our, out, please, saw, there, these, those, think, though, through, today, too, two, use, walk, want, whole, word, work, write.

**Bonus:** live (as in “I live here”).

## CSV format

`pippas_power_words.csv` contains these columns:

| Column | Meaning |
|---|---|
| `word` | Lowercase spelling to guess |
| `source_list` | `50 Power Words` or `Power Word Bank` |
| `bonus_word` | `yes` for the two starred bonus words; otherwise `no` |
| `reading_mastered` | Blank until assessed; optionally use `yes`/`no` |
| `writing_mastered` | Blank until assessed; optionally use `yes`/`no` |

## Implementation notes for the Android game

- Target: Lenovo Tab P11 (TB-J606F), Android 11. A locally installed APK does not require rooting or Play Store publication.
- Implement as an offline HTML/CSS/JavaScript game packaged with Capacitor, or as a native Android app.
- Import the CSV as UTF-8, retaining `source_list` so players can choose either sheet or both.
- Select a random word and show one blank per letter; allow touchscreen alphabet guesses.
- Compare guesses case-insensitively; do not penalize repeated guesses.
- Use a configurable incorrect-guess limit (e.g. six), then show the word and offer another round.
- Record attempted words, correct guesses, and missed words locally; favor missed words in subsequent rounds.
- Keep progress records separate from the imported source word list.
- Add optional parent controls for importing a new CSV, resetting progress, and reviewing practice history.
- For two-letter and three-letter words, consider fewer hints or a separate practice mode: they can be unusually easy in Hangman.
- The supplied sheets contain no definitions or hints. Any generated hints should be reviewed before use, especially for words such as `there`, `their`, `they`, `to`, `too`, and `two`.

## Suggested minimum viable version

1. Fullscreen, tablet-friendly offline Hangman screen.
2. Choose **50 Power Words**, **Power Word Bank**, or **All Words**.
3. On-screen letter keyboard, visible progress, replay.
4. Local record of words missed, with a **Practice missed words** option.
5. Parent-only CSV import for future word lists.
