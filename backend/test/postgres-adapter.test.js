const test = require('node:test');
const assert = require('node:assert/strict');

const {
  positionalPlaceholdersToPostgres
} = require('../db/postgres');

test('positionalPlaceholdersToPostgres converts positional placeholders', () => {
  assert.equal(
    positionalPlaceholdersToPostgres('SELECT * FROM users WHERE email = ? AND id = ?'),
    'SELECT * FROM users WHERE email = $1 AND id = $2'
  );
});

test('positionalPlaceholdersToPostgres ignores placeholders inside strings', () => {
  assert.equal(
    positionalPlaceholdersToPostgres("SELECT '?' as literal, name FROM users WHERE email = ?"),
    "SELECT '?' as literal, name FROM users WHERE email = $1"
  );
});

test('positionalPlaceholdersToPostgres ignores placeholders inside comments', () => {
  assert.equal(
    positionalPlaceholdersToPostgres('SELECT * FROM users -- ? ignored\nWHERE id = ? /* ? ignored */'),
    'SELECT * FROM users -- ? ignored\nWHERE id = $1 /* ? ignored */'
  );
});
