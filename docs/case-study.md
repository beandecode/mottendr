# Building Mottendr

I'm learning French, and over time I'd put together my own word list: around 3,400 words, each with its part of
speech, gender, conjugation and often several senses. None of the flashcard apps I tried could hold that properly,
and the ones with clever scheduling wouldn't tell me why a card came back when it did. So I started writing my own.
The data stays on the phone, scheduling uses FSRS (an open, well-studied algorithm), and explanations can be in
Chinese, English or both.

I started on 5 October 2026 with a web app you could install from a link and use offline. What pushed me
further was the iPhone Duo, the foldable iPhone with an outer and an inner screen. I wanted the app to feel right on
both screens, and a web page in a shell wasn't going to get there. On 27 October I decided to rewrite it in SwiftUI,
and about a week later the native code did everything the web app did.

## How it's put together

The word list and the learner's progress are kept apart. The word list ships read-only and versioned. The learner's
file only stores what differs from it (notes, review history), keyed by stable IDs. That's what lets me keep
improving the word list without touching anyone's progress. A manifest records every published ID and revision, a
bit like a lockfile, and the build fails if an ID goes missing or an entry changes without being recorded.

The entry structure is defined once, in TypeBox. The TypeScript types, the runtime validation and a JSON Schema for
the Python content scripts all come from that one definition, so they can't drift apart.

For the native app, the web code became the specification. It writes golden fixtures, and the Swift package has to
reproduce them exactly. Before porting anything I wrote down which parts had to match exactly (anything that gets
saved, exported, shared or fed into scheduling) and which parts I was free to redesign, which turned out to be
everything that only existed because of the browser.

The native study screen has no rating buttons. I tried buttons, then tap zones, and ended up with swiping: the card
tints as you drag and the phone gives a small haptic tick. On a small screen, fewer controls worked better.

## The word list

The raw content was uneven. Some sources were good and some weren't, definitions mixed parts of speech, and many
words had no examples at all. I wrote a definition of done for an entry (senses, a short definition, usage notes and
examples, in both languages) and set up a pipeline to rewrite entries against it. Everything goes through one script,
which keeps the working files and runs mechanical checks on each batch. A batch is only accepted after a review done
separately from the step that wrote it. Entries that pass get a fixed edition number, along with a record of whether
they had a full check or a spot check.

By mid-November about 2,800 of the 4,100 entries had been rewritten and 2,145 had an edition, including all 1,999
entries going into the first App Store release.

My part is deciding what the app should be, the architecture, the rules and the review gates, and testing
everything on the phone myself.

## Mistakes

### Saving everything on every review

In the first web version, rating a single card copied, validated and wrote the entire state, about 10 MB, to
IndexedDB. It got slower the more I studied. I split storage into separate records and used structural sharing, so a
review now writes about 2 KB, and a revision check stops an older write from overwriting a newer one. What surprised
me was that my first fix only solved half the problem. I found the other half only because I timed the "fixed"
version too. A test comparing the old and new code paths also caught a change I'd assumed was harmless.

### Wrapping the web app for iPhone

My first iPhone build put the web app inside a Capacitor shell. The very first launch failed to save: the old state
was a single JSON string of about 19.6 million characters, more than the bridge would take. Once storage was fixed,
it still felt worse than the same app in Safari. It was capped at 60 Hz, and main-thread work landed on the first
frames of animations. I could have kept patching, but it was never going to feel the way I wanted, so I went native.

The hard part was making sure the two versions agreed. I had the web code write fixtures with the time zone, random
source and clock all pinned, and the Swift port had to match them exactly, with no tolerances. The scheduling numbers now come out identical down to
the bit, not just close. Somewhere along the
way I also learned to treat key order as part of the data.

### Letting the writing step check its own work

An early pilot of the content rewrite produced things like "ils sontaient", the wrong part of speech for *ce*, and a
sense for *tour* that mixed up "tower" and "lap". I threw the pilot out. Now each word is completed as a whole,
against the definition of done. Reviewing a batch in the same step that wrote it did catch real mistakes, but it
missed the structural ones. So review is now separate from writing, a spot check follows it, and an entry only gets
an edition number once it passes.

### Treating a foldable like a big phone

On the Duo's short outer screen, answers were getting cut off because my layout only looked at width. There was also
a strip on the right I couldn't explain, which turned out to be a system column. Before changing any more layout, I
added an on-screen readout of the real safe areas, and only then added height breakpoints. There were no device specs
to go on, so measuring first saved a lot of guessing.

## Where it stands

I use the iPhone app every day now. The web version lives on as a public demo with the 300 most common words and a
dictionary of the first 500. Next I want to put the app on the App Store for free, add more words with each update
through an "add new library words" flow, and link the demo to the App Store page.
