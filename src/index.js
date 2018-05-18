const http = require('http');
/**
 * Add to the request prototype.
 */

module.exports = function (superagent) {
    const Request = superagent.Request

    Request.prototype.oldRetry = Request.prototype.retry
    Request.prototype.retry = retry
    Request.prototype.callback = callback

    return superagent
}

/**
 * Works out whether we should retry, based on the number of retries, on any passed
 * errors and response and compared against a list of allowed error statuses.
 *
 * @param {Number} retries
 * @param {Error} err
 * @param {Response} res
 */
function shouldRetry(err, res, allowedStatuses, disallowedStatuses) {
    const ERROR_CODES = [
        'ECONNRESET',
        'ETIMEDOUT',
        'EADDRINFO',
        'ESOCKETTIMEDOUT',
        'ENOTFOUND'
    ]

    if (err && err.code && ~ERROR_CODES.indexOf(err.code)) {
        return true
    }

    if (res && res.status) {
        const status = res.status

        if(disallowedStatuses.indexOf(status) > -1){
            return false;
        }

        if (status >= 500) {
            return true
        }

        if ((status >= 400 || status < 200) && allowedStatuses.indexOf(status) === -1) {
            return true
        }
    }

    // Superagent timeout
    if (err && 'timeout' in err && err.code === 'ECONNABORTED') {
        return true
    }

    if (err && 'crossDomain' in err) {
        return true
    }

    return false
}

/**
 * Override Request callback to set a timeout on the call to retry.
 *
 * This overrides crucial behaviour: it will retry on ANY error (eg 401...) due to shouldRetry having
 * different behaviour.
 *
 * @param err
 * @param res
 * @return {Object}
 */

function callback(err, res) {
    if (this._maxRetries && this._retries++ < this._maxRetries && shouldRetry(err, res, this._allowedStatuses, this.disallowedStatuses)) {
        var req = this
        return setTimeout(function () {
            return req._retry()
        }, this._retryDelay)
    }

    // Avoid the error which is emitted from 'socket hang up' to cause the fn undefined error on JS runtime.
    const fn = this._callback || noop;
    this.clearTimeout();
    if (this.called) return console.warn('superagent: double callback bug');
    this.called = true;

    if (!err) {
        try {
            if (!this._isResponseOK(res)) {
                let msg = 'Unsuccessful HTTP response';
                if (res) {
                    msg = http.STATUS_CODES[res.status] || msg;
                }
                err = new Error(msg);
                err.status = res ? res.status : undefined;
            }
        } catch (new_err) {
            err = new_err;
        }
    }
    // It's important that the callback is called outside try/catch
    // to avoid double callback
    if (!err) {
        return fn(null, res);
    }

    err.response = res;
    if (this._maxRetries) err.retries = this._retries - 1;

    // only emit error event if there is a listener
    // otherwise we assume the callback to `.end()` will get the error
    if (err && this.listeners('error').length > 0) {
        this.emit('error', err);
    }

    fn(err, res);
};

/**
 * Override Request retry to also set a delay.
 *
 * In miliseconds.
 *
 * @param {Number} retries
 * @param {Number} delay
 * @param {Number[]} allowedStatuses
 * @return {retry}
 */
function retry(retries, delay, allowedStatuses, disallowedStatuses) {
    if (arguments.length === 0 || retries === true) {
        retries = 1
    }

    if (retries <= 0) {
        retries = 0
    }

    this._maxRetries = retries
    this._retries = 0
    this._retryDelay = delay || 0
    this._allowedStatuses = allowedStatuses || []
    this._disallowedStatuses = disallowedStatuses || []

    return this
}
