# Case study: building Mottendr

## The problem

I am learning French, and I could not find an app that fitted how I wanted to learn. I had my own word list (about
3,400 words) with parts of speech, several senses per word, gender and conjugation, and the flashcard apps I tried
either could not hold that structure or scheduled reviews in ways I could not inspect. I wanted an app where the data
is mine, the scheduling is a proven algorithm (FSRS), and the explanations work in Chinese, English or both.

Then I bought an iPhone Duo, a foldable iPhone with an outer and an inner screen, and it gave the project a second
reason: a study app should feel good on both screens, and that is something only a native app can do properly. So I
built one: first as a web app, then as a native iPhone app.

The work started on 5 October 2026 (the first commit) with a web app that could be installed on a phone from a link
and used offline. The native rewrite was decided on 27 October, and its code was feature-complete about a week later.

## Decisions that shaped it

1. **Web first, local only.** A PWA with IndexedDB needs no server, works offline and can be installed from a link.
   That made the first version fast to build and test on a phone.
2. **Content and learner data are two layers.** The built-in word list is read-only and versioned; the learner's file
   holds only differences, addressed by stable IDs. This is what lets the word list improve over time (hundreds of
   rewriting batches) without ever overwriting a learner's notes or progress. A manifest acts as a lockfile for
   published IDs and revisions, and the build refuses lost IDs or unrecorded content changes.
3. **Small writes.** A review used to rewrite the whole ~10 MB state. Splitting storage by record means a review writes
   about 2 KB, with a revision check so a stale writer cannot overwrite a newer one.
4. **One schema.** The entry structure is defined once (TypeBox) and produces the types, the validation and a JSON
   Schema that the Python content tools share.
5. **Native rewrite, guarded by fixtures.** The things that decide how a study app feels (drag, haptics, frame rate) are
   native territory, so I rewrote it in SwiftUI. To keep the two apps honest, the web logic is the specification:
   it produces golden data that the Swift package must reproduce. I wrote down a rule for what to port exactly
   (anything saved, exported, shared or feeding scheduling) and what to redesign natively (everything that exists only
   because of the browser).
6. **Rating is a swipe.** After trying buttons and zones, the native study screen rates by swipe only, with a tint and
   haptic feedback; fewer controls on a small screen.

## Content at scale

The word list itself needed work: sources of uneven quality, definitions mixing parts of speech, missing examples.
I designed a rewriting pipeline around a written definition of done (senses, short definition, usage notes,
examples, in two languages). All work goes through one script that keeps the job's files and checks every batch
mechanically, and a batch is accepted only after an independent review, separate from the step that wrote it.
Tiered checks (full, spot) and a fixed edition number per entry record how far each entry got. By mid-November 2026
about 2,800 of 4,100 entries were rewritten and 2,145 had an edition, including all 1,999 entries of the first App
Store release.

My role: I set the product direction and the architecture, wrote the rules, the definition of done and the review
gates, made the design decisions above, and verify behaviour on the phone.

## Results

- Scheduler values in Swift are bit-identical to the web version's `ts-fsrs` results on the fixtures.
- Lookup is instant (0 ms) and the slowest search takes 6.9 ms on a Mac.
- The web app is a ~715 kB bundle plus hashed data files and works fully offline.

## What went wrong, and what I learned

**1. Every review rewrote the whole state.** In the first web version, rating one card copied, validated and wrote
the full ~10 MB state to IndexedDB, and it got slower as the history grew. I split storage by record and used
structural sharing so only changed records are touched (about 2 KB per review). The lesson was to measure before and
after: half of the real bottleneck only showed up when I timed the "fixed" version, and a test that the old and new
paths give the same result caught what looked like a harmless change.

**2. The Capacitor shell was the wrong layer.** My first iPhone build wrapped the web app in a native shell. On its
first launch it failed to save: the old state was one JSON string of about 19.6 million characters, over the bridge's
limit. After the storage was fixed, the shell still felt less smooth than Safari (capped at 60 Hz, work on the main
thread landing on the first animation frames). Fixing symptoms one by one would not have reached the quality I
wanted, so I decided on the native rewrite. To make it safe I kept the web logic as the specification and had it write
golden fixtures with the time zone, random source and clock pinned; the Swift port had to match them exactly, with no
tolerances. The lesson: pin everything that varies, keep key order as data, and put logic where it can be tested on
both sides.

**3. Generated content had errors that a self-review missed.** An early pilot produced forms like "ils
sontaient", a wrong part of speech for *ce*, and a sense that mixed "tower" with "lap" for *tour*. I withdrew the
pilot and changed the job to whole-word completion with a written definition of done. A review by the same step that
wrote a batch caught real mistakes but not structural ones, so the rule became: the review is independent of the
writing, a second check spot-checks after it, and an entry only gets an edition number when it passes. The lesson:
fix the structure before adding content, and never let the author be the only reviewer.

**4. A foldable screen is not a bigger phone.** On the Duo's short outer screen, answers were cut off because my
layout only looked at width, and an unexplained strip on the right turned out to be a system column. I added height
breakpoints, and, before touching any layout, an on-screen readout of the real safe areas. The lesson: with no device
data, build the measuring tool first.

## What I would do next

Release the app (free, on the App Store), then ship more words per update with an "add new library words" flow, and
point the web demo at the App Store page.
