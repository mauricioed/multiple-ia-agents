'use strict';
const { createHash } = require('node:crypto');

// Preserve the Marketplace listing's reviewed icon without allowing other binaries.
function isReleaseIcon(name, bytes) {
  return name === 'media/icon.png' &&
    createHash('sha256').update(bytes).digest('hex') === 'f841f89f2c12874fda0f05651a54c32edd59c2d6d929ba4664dcdae43062444e';
}

module.exports = { isReleaseIcon };
