'use strict';
const { createHash } = require('node:crypto');

const approvedHashes = new Map([
  ['media/icon.png', [
    'f841f89f2c12874fda0f05651a54c32edd59c2d6d929ba4664dcdae43062444e',
    '4ef68535b9d49fe1e08f5061fa3a17c9f6bd4176c105c801e952388a5ee44d33'
  ]],
  ['media/demo-extension.gif', ['87d94105fb1e78e7a0d045619bc6d72f97c1fbb6072dbfa1b7948238689a0de7']],
]);

function isReleaseAsset(name, bytes) {
  const expected = approvedHashes.get(name);
  return expected?.includes(createHash('sha256').update(bytes).digest('hex')) ?? false;
}

module.exports = { isReleaseAsset };
