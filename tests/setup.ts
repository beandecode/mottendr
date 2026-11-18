import { contentFiles } from '../src/content/build';
import { setContent } from '../src/content/files';

// The app downloads these files; tests load them straight from the sources.
const files = contentFiles();
setContent('word-list', files['word-list']);
setContent('legacy-upgrade', files['legacy-upgrade']);
setContent('dictionary', files.dictionary);
