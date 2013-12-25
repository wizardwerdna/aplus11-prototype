module.exports = function qFactory(nextTick) {
  function Promise(then, handler) {
    if (then) {
      this.then = then;
    }
    if (!handler) {
      handler = new PendingHandler(this);
    }
    this.handler = handler;
    this.decorated = new DecoratedPromise(this);
  }
  function DecoratedPromise(self) {
    this.promise = new DecoratedThenable(self);
    this.resolve = function(value) {
      return self.resolve(value);
    }
    this.reject = function(reason) {
      return self.reject(reason);
    }
  }

  function DecoratedThenable(self) {
    this.then = function(onFulfilled, onRejected) {
      return self.handler.then(onFulfilled, onRejected);
    }
    // TODO: When WeakMap is more available, acquire state through WeakMap...
    this._deferred = self;
  }
  
  DecoratedThenable.prototype = {
    constructor: DecoratedThenable
  };

  DecoratedPromise.prototype = {
    constructor: DecoratedPromise
  };

  Promise.prototype = {
    constructor: Promise,

    then: function(onFulfilled, onRejected) {
      return this.handler.then(onFulfilled, onRejected);
    },

    resolve: function(value) {
      if (value === this.decorated.promise) {
        throw new TypeError();
      }
      return this.handler.resolve(value);
    },

    reject: function(reason) {
      if (reason === this.decorated.promise) {
        throw new TypeError();
      }
      return this.handler.reject(reason);
    },

    acquireState: function(deferred) {
      if (this !== deferred) {
        this.handler = deferred.handler;
        this.promise = deferred.promise;
      }
    },

    finish: function(value, method, handler) {
      var decorated = this.decorated, then;

      if (value instanceof DecoratedThenable) {
        value.then(function(value) {
          decorated.resolve(value);
        }, function(reason) {
          decorated.reject(reason);
        });
        return decorated.promise;
      } else if (value && typeof value === 'object' || typeof value === 'function') {
        try {
          then = value.then;
        } catch (e) {
          decorated.reject(e);
          return decorated.promise;
        }
        if (typeof then === 'function') {
          var called = 0;
          try {
            then.call(value, function resolvePromise(y) {
              if (!called) {
                called = 1;
                decorated.resolve(y);
              }
            }, function rejectPromise(r) {
              if (!called) {
                called = 1;
                decorated.reject(r);
              }
            });
          } catch (e) {
            if (!called) {
              decorated.reject(e);
            }
          }
          return decorated.promise;
        }
      }

      var messages = this.handler.messages, message;
      delete this.handler.messages;

      this.handler = handler;

      if (messages) {
        nextTick(function() {
          for (var i=0, ii = messages.length; i<ii; ++i) {
            message = messages[i];
            message[method](value);
          }
        });
      }
      return decorated.promise;
    }
  };

  function wrap(deferred, method, value) {
    if (typeof value === 'function') {
      return function(val) {
        try {
          deferred.resolve(value(val));
        } catch (e) {
          deferred.reject(e);
        }
      };
    } else {
      return function(val) {
        deferred[method](val);
      };
    }
  }

  function PendingHandler(promise) { this.promise = promise; }
  PendingHandler.prototype = {
    constructor: PendingHandler,
    then: function(onFulfilled, onRejected) {
      var messages = (this.messages || (this.messages = []));
      var deferred = defer();
      messages.push({
        onFulfilled: wrap(deferred, 'resolve', onFulfilled),
        onRejected: wrap(deferred, 'reject', onRejected)
      });
      return deferred.promise;
    },
    resolve: function(value) {
      // CHANGE STATE -> RESOLVED
      return this.promise.finish(value, 'onFulfilled', new ResolvedHandler(this.promise, value));
    },
    reject: function(reason) {
      // CHANGE STATE -> REJECTED
      return this.promise.finish(reason, 'onRejected', new RejectedHandler(this.promise, reason));
    },
    state: 'pending'
  };
  function ResolvedHandler(promise, value) { this.promise = promise; this.value = value; }
  ResolvedHandler.prototype = {
    constructor: ResolvedHandler,
    then: function(onFulfilled, onRejected) {
      var deferred = defer();
      var wrapped = wrap(deferred, 'resolve', onFulfilled);
      var value = this.value;
      if (!this.messages) {
        this.messages = [];
        var messages = this.messages, message, self = this;
        if (value instanceof DecoratedThenable) {
          // This is really my corny interpretation of 2.3.2... This may not be necessary at all.
          // If can get away without storing _deferred at all, that would be awesome.
          messages = value._deferred.handler.messages;
        }
        nextTick(function() {
          delete self.messages;
          for (var i=0, ii = messages.length; i<ii; ++i) {
            message = messages[i];
            message(value);
          }
        });
      }
      this.messages.push(wrapped);
      return deferred.promise;
    },
    resolve: function(value) {
      // ALREADY RESOLVED
      return this.promise.decorated.promise;
    },
    reject: function(reason) {
      // ALREADY RESOLVED
      return this.promise.decorated.promise;
    },
    state: 'fulfilled'
  };
  function RejectedHandler(promise, reason) { this.promise = promise; this.reason = reason; }
  RejectedHandler.prototype = {
    constructor: RejectedHandler,
    then: function(onFulfilled, onRejected) {
      var deferred = defer();
      var wrapped = wrap(deferred, 'reject', onRejected);
      var reason = this.reason;
      if (!this.messages) {
        this.messages = [];
        var messages = this.messages, message, self = this;
        if (reason instanceof DecoratedThenable) {
          // This is really my corny interpretation of 2.3.2... This may not be necessary at all.
          // If can get away without storing _deferred at all, that would be awesome.
          messages = reason._deferred.handler.messages;
        }
        nextTick(function() {
          self.messages = null;
          for (var i=0, ii = messages.length; i<ii; ++i) {
            message = messages[i];
            message(reason);
          }
        });
      }
      this.messages.push(wrapped);
      return deferred.promise;
    },
    resolve: function(value) {
      // ALREADY REJECTED
      return this.promise.decorated.promise;
    },
    reject: function(reason) {
      // ALREADY REJECTED
      return this.promise.decorated.promise;
    },
    state: 'rejected'
  };

  var defer = function() {
    var self = new Promise();

    return self.decorated;
  };

  return {
    defer: defer
  };
}
