var Q = require('./promise')(process.nextTick);
exports.deferred = Q.defer;
