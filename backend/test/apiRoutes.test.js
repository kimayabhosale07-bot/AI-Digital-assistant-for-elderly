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
  assert.equal(routes.some(route => /notifications|sms|emergency/i.test(route)), false);
});
