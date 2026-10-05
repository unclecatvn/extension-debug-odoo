import assert from 'node:assert/strict';
import { parsePo, _t } from '../../../src/i18n/i18n.ts';

const po = parsePo(`# comment
msgid ""
msgstr ""
"Language: vi\\n"

#: a.js:1
msgid "Hello %s"
msgstr "Xin chào %s"

msgid ""
"Two "
"lines \\"q\\""
msgstr "Hai dòng \\"q\\""

#, fuzzy
msgid "Fuzzy"
msgstr "Mờ"

msgid "Empty"
msgstr ""
`);
assert.deepEqual([...po], [['Hello %s', 'Xin chào %s'], ['Two lines "q"', 'Hai dòng "q"']]);
assert.equal(_t('Missing %s of %s', 1, 2), 'Missing 1 of 2');
assert.equal(_t('No args %s'), 'No args ');
