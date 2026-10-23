const test = require('node:test');
const assert = require('node:assert/strict');
const router = require('../src/routes/api');

test('API keeps core routes and excludes removed delivery routes', () => {
  const routes = router.stack
    .filter(layer => layer.route)
    .flatMap(layer => Object.keys(layer.route.methods).map(method => `${method.toUpperCase()} ${layer.route.path}`));

  assert.ok(routes.includes('POST /register'));
  assert.ok(routes.includes('POST /medicine'));
  assert.ok(routes.includes('POST /appointment'));
  assert.ok(routes.includes('POST /health-log'));
  assert.ok(routes.includes('GET /health-log/:userId'));
  assert.ok(routes.includes('POST /assistant/chat'));
  assert.ok(routes.includes('POST /assistant/medicine/confirm'));
  assert.ok(routes.includes('POST /assistant/transcribe'));
  assert.equal(routes.some(route => /notifications|sms|emergency/i.test(route)), false);
});
