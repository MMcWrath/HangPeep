# HangPeeps

An offline, kid-friendly Hangman game built for practising Pippa's Power Words on an
Android tablet (Lenovo Tab P11, Android 11).

Instead of a hanging figure, **Peep** the chick floats on balloons. Each wrong letter pops
a balloon and Peep drifts lower. Guess the word and Peep flies home. Run out of balloons
and Peep bumps down gently on the grass, and the word is shown and read aloud.

## Installing on the tablet

1. On the tablet, open **github.com/MMcWrath/HangPeep → Releases** (sign in to GitHub),
   and download `HangPeeps.apk` from the newest release.
2. Open the downloaded file. The first time, Android asks you to allow installs from
   your browser (or Files app): turn on **Allow from this source**, then go back and tap **Install**.
3. To update later, download the newer APK and install it over the top. Progress is kept.

No rooting, Play Store or internet connection is needed to play.

## What's in the game

- **Lists:** *50 Power Words*, *Power Word Bank*, or *All Words* (one button per `source_list` in the CSV).
- **Big on-screen a–z keyboard.** Repeat guesses are free and don't pop a balloon.
- **Practice missed words:** words Pippa missed come up more often everywhere, and this
  mode drills only the ones still missed. A word leaves the list once it's guessed more often than missed.
- **Speech:** the word is read aloud after each round (uses the tablet's text-to-speech).
  *Spelling mode* says the word at the start instead, so she spells what she hears.
- **Grown-ups area** (behind a quick multiplication question):
  - balloons per round (3–10, default 6), skip 2–3 letter words, CAPITAL letters, sounds, speech;
  - per-word progress (played / guessed / missed) with **R**/**W** toggles for reading and writing mastery;
  - recent rounds, including the wrong letters guessed;
  - import a new CSV word list (file or pasted text), or restore the built-in list;
  - show progress as CSV, or reset progress.

Progress is stored separately from the word list, so importing a new list never erases it.
All data stays on the tablet.

## Word list format

See [`docs/pippas_power_words.md`](docs/pippas_power_words.md). Only a `word` column is
required; `source_list`, `bonus_word`, `reading_mastered`, `writing_mastered` are optional.
A plain list with one word per line also works.

To change the **built-in** list, edit `data/pippas_power_words.csv`, run
`node tools/sync-words.mjs`, and commit. CI fails if the two are out of sync.

## Project layout

| Path | What |
|---|---|
| `web/` | The game: plain HTML/CSS/JS, no build step. Open `web/index.html` in a browser to play/test. |
| `android/` | Minimal native wrapper: one `Activity` with a fullscreen WebView, plus text-to-speech, file picker and back button. |
| `data/`, `docs/` | Source word list and notes. |
| `.github/workflows/build-apk.yml` | Builds the signed APK on every push and publishes it as a GitHub Release. |

## Signing

Android only installs an update if it's signed with the same key as the installed app.
The key is never committed. CI reads it from the `HP_KEYSTORE_B64` repository secret
(the base64 of a `.jks` file). If its passwords aren't the default `hangpeeps`, also set
`HP_STORE_PASSWORD` and `HP_KEY_PASSWORD`. Without the secret, each build is signed with a
throwaway key. It installs fine on a fresh tablet, but a later build won't install over it
without uninstalling first, and uninstalling erases progress.

To make a key and store it (any machine with Java):

```bash
keytool -genkeypair -keystore hangpeeps.jks -storepass hangpeeps -keypass hangpeeps \
  -alias hangpeeps -keyalg RSA -keysize 2048 -validity 36500 -dname "CN=HangPeeps"
base64 -w0 hangpeeps.jks   # paste into GitHub → Settings → Secrets and variables → Actions → HP_KEYSTORE_B64
```

Keep a copy of the `.jks` somewhere safe. Losing it means the next update needs an uninstall.
