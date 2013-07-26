var pdu = require('pdu');

var EventEmitter = require('events').EventEmitter;

var createSession = function() {
    var ussd_session = new EventEmitter();

    ussd_session.modem = false;
    ussd_session.expect_more_data = false;
    ussd_session.closed = false;
    ussd_session.state = 'pending';

    ussd_session.start = function() {
        this.modem.on('data',this.findUssdResponse);
        this.execute();
    }

    ussd_session.setTimeout = function(ms) {
        this.timeout = setTimeout(function() {
            this.emit('timeout');
            this.close();
        }.bind(this), ms);

        this.on('close', function() {
            this.clearTimeout();
        });
    }

    ussd_session.clearTimeout = function() {
        clearTimeout(this.timeout);
    }

    ussd_session.query = function(string, callback, end) {
        if(callback)
            this.once('response', callback);
        var encoded = ussd_session.encode(string);

        var session = this;
        var execute_job = this.modem.execute('AT+CUSD=1,"'+encoded+'",15', function(response, escape_char) {
            if(escape_char.match(/error/i))
                session.close();
        }, end);

        if(!execute_job)
            return ;

        var session = this;
        execute_job.on('start', function() {
            if(session.state == 'pending') {
                session.state = 'started';
                session.emit('start');
                session.setTimeout(10000);
            }

            session.emit('request', string);
        });
    }

    ussd_session.close = function(callback) {
        if(!this.closed) {
            this.modem.execute('AT+CUSD=2', callback);
            this.state = 'closed';
            this.emit('close');
        }
    }

    ussd_session.isResponseCompleted = function() {
        var args = this.modem.parseResponse(this.partial_data);
        return (args[1] && this.partial_data.match(/\"/g).length === 2);
    }

    ussd_session.appendResponse = function(data) {
        this.partial_data += data;
    }

    ussd_session.responseCompleted = function() {
        var args = this.modem.parseResponse(this.partial_data);

        if(this.modem.ussd_pdu && args[2] == '15')
            var response = pdu.decode7Bit(args[1]);
        else if(this.modem.ussd_pdu)
            var response = pdu.decode16Bit(args[1]);
        else
            var response = args[1];

        this.expect_more_data = false;
        this.partial_data = '';
        this.partial_response_code = '';

        this.closed = (args[0] == '2' || args[0] == '0');

        this.emit('response', args[0], response.replace(/\u0000/g, ''), args[2]);

        if(this.closed && !this.expect_more_data) {
            this.emit('close');
            this.state = 'closed';
        }
    }

    ussd_session.findUssdResponse = function(data, escape_char) {
        var data = data.trim();

        if(data === '+CME ERROR: retry operation' || data === '+CUSD: 4') {
            this.modem.ussd_pdu = false;
            this.close();
            return ;
        }


        if(data.slice(0,5).trim() === '+CUSD') {
            //USSD response starts.
            this.appendResponse(data);

            if(this.isResponseCompleted(data))
                this.responseCompleted(data);
            else
                this.expect_more_data = true;

            return ;
        }

        //Not a +CUSD. If we arent expecting more data, this has nothing to do with us.
        if(!this.expect_more_data)
            return ;

        //There should be some data coming from last part(s) of message.
        if(!this.partial_data)
            return ;

        if(data.slice(0, 1) === '+' || data.slice(0, 1) === '^')
            return ; //Ignore notifications.

        this.appendResponse(data);
        if(this.isResponseCompleted())
            this.responseCompleted();

    }.bind(ussd_session);

    ussd_session.on('close', function() {
        this.modem.removeListener('data', this.findUssdResponse);
    });

    ussd_session.encode = function(string) {
        if(ussd_session.modem.ussd_pdu)
            return pdu.encode7Bit(string);
        else
            return string;
    }

    return ussd_session;
}

module.exports = createSession;
